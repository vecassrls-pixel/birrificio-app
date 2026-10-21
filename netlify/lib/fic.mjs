// Fatture in Cloud (https://developers.fattureincloud.it), usata dal proxy dell'app
// (netlify/functions/fattureincloud.mjs) e dall'import automatico (netlify/lib/automazioni.mjs).
// Scrive solo per creare una fattura dal carrello della birra (creaFattura).
// Variabili d'ambiente Netlify: FIC_TOKEN, FIC_COMPANY_ID (facoltativo: altrimenti la prima azienda del token)

const BASE = 'https://api-v2.fattureincloud.it';
export const configurato = () => !!process.env.FIC_TOKEN;
export const NOMI_TIPO = { invoice: 'Fattura', delivery_note: 'DDT', receipt: 'Ricevuta', credit_note: 'Nota di credito' };

export async function client() {
  const token = process.env.FIC_TOKEN;
  let azienda = process.env.FIC_COMPANY_ID;
  const chiama = async (path, params = {}, conAzienda = true, corpo = null) => {
    const res = await fetch(`${BASE}${conAzienda ? `/c/${encodeURIComponent(azienda)}` : ''}${path}?${new URLSearchParams(params)}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify({ data: corpo }) } : {}),
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const b = await res.json();
        const campi = Object.values(b.error?.validation_result || {}).flat().filter(x => typeof x === 'string');
        msg = [b.error?.message, ...campi].filter(Boolean).join(': ') || msg;
      } catch { /* non JSON */ }
      throw Object.assign(new Error(`Fatture in Cloud: ${msg} (${res.status})`), { status: res.status });
    }
    return res.json();
  };
  if (!azienda) {
    const u = await chiama('/user/companies', {}, false);
    azienda = u.data?.companies?.[0]?.id;
    if (!azienda) throw Object.assign(new Error('Il token di Fatture in Cloud non ha accesso a nessuna azienda'), { status: 502 });
  }
  return { chiama };
}

// elenco paginato fino a max documenti; quelli senza righe nell'elenco si leggono uno per uno (5 alla volta)
async function elenco(fic, path, params, max, dettaglio) {
  const docs = [];
  let altri = false;
  for (let pagina = 1; ; pagina++) {
    const r = await fic.chiama(path, { ...params, fieldset: 'detailed', sort: 'date', page: pagina, per_page: 50 });
    docs.push(...(r.data || []));
    if (docs.length >= max) { altri = docs.length > max || pagina < (r.last_page || 1); break; }
    if (pagina >= (r.last_page || 1)) break;
  }
  const scelti = docs.slice(0, max);
  for (let i = 0; i < scelti.length; i += 5) {
    await Promise.all(scelti.slice(i, i + 5).map(async (d, j) => {
      if (Array.isArray(d.items_list)) return;
      scelti[i + j] = (await fic.chiama(`${dettaglio}/${d.id}`, { fieldset: 'detailed' })).data;
    }));
  }
  return { scelti, altri };
}

// Documenti emessi (fatture, DDT, ricevute, note di credito) nel formato comune ai proxy:
// { id, numero, data, cliente, telefono, email, righe: [{ codice, nome, qta }] }
export async function documentiEmessi(fic, { tipo = 'invoice', dal, max = 60 }) {
  const { scelti, altri } = await elenco(fic, '/issued_documents', { type: tipo, q: `date >= '${dal}'` }, max, '/issued_documents');
  return {
    altri,
    documenti: scelti.map(d => ({
      id: String(d.id),
      numero: `${NOMI_TIPO[tipo] || 'Documento'} ${d.number ?? ''}${d.numeration || ''}`.trim(),
      data: d.date,
      cliente: d.entity?.name || '',
      telefono: d.entity?.phone || '',
      email: d.entity?.email || '',
      stato: '',
      righe: (d.items_list || []).filter(r => Number(r.qty) > 0).map(r => ({ codice: r.code || '', nome: r.name || r.description || '', qta: Number(r.qty) })),
    })),
  };
}

// Documenti di acquisto (fatture dei fornitori), per le bolle delle materie prime:
// { id, numero, data, fornitore, righe: [{ codice, descrizione, um, qta, prezzo }] } (prezzo netto per unità)
export async function acquisti(fic, { dal, max = 40 }) {
  const { scelti, altri } = await elenco(fic, '/received_documents', { type: 'expense', q: `date >= '${dal}'` }, max, '/received_documents');
  return {
    altri,
    documenti: scelti.map(d => ({
      id: String(d.id),
      numero: d.invoice_number || '',
      data: d.date,
      fornitore: d.entity?.name || '',
      righe: (d.items_list || []).filter(r => Number(r.qty) > 0).map(r => ({
        codice: r.code || '', descrizione: r.name || r.description || '', um: String(r.measure || '').toUpperCase(), qta: Number(r.qty),
        ...(Number(r.net_price) > 0 ? { prezzo: Number(r.net_price) } : {}),
      })),
    })),
  };
}

export async function prodotti(fic) {
  const out = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await fic.chiama('/products', { fieldset: 'basic', sort: 'name', page: pagina, per_page: 100 });
    out.push(...(r.data || []));
    if (pagina >= (r.last_page || 1)) break;
  }
  return out.map(p => ({ id: String(p.id), nome: p.name || '', codice: p.code || '' }));
}

// Anagrafica clienti: [{ id, nome, piva }]
export async function clienti(fic) {
  const out = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await fic.chiama('/entities/clients', { fieldset: 'detailed', sort: 'name', page: pagina, per_page: 100 });
    out.push(...(r.data || []));
    if (pagina >= (r.last_page || 1)) break;
  }
  // indirizzo e telefono dall'anagrafica: servono alle consegne degli ordini
  const t = v => String(v || '').trim();
  return out.map(c => ({
    id: c.id, nome: c.name || '', piva: c.vat_number || c.tax_code || '',
    indirizzo: t(c.address_street), comune: [t(c.address_postal_code), t(c.address_city), t(c.address_province) ? `(${t(c.address_province)})` : ''].filter(Boolean).join(' '),
    telefono: t(c.phone),
  }));
}

// Crea una fattura con le righe del carrello; la si completa e si invia in Fatture in Cloud.
// { data, cliente: { id?, nome }, lordo (prezzi IVA inclusa), aliquota, note,
//   righe: [{ codice, nome, descrizione, qta, prezzo }] } → { id, numero, url }
export async function creaFattura(fic, { data, cliente, righe, lordo = false, aliquota = 22, note = '' }) {
  const iva = (await fic.chiama('/info/vat_types')).data || [];
  const vat = iva.find(v => Number(v.value) === Number(aliquota) && !v.is_disabled && !v.e_invoice) || iva.find(v => Number(v.value) === Number(aliquota) && !v.is_disabled);
  if (!vat) throw Object.assign(new Error(`Fatture in Cloud: non trovo l'aliquota IVA ${aliquota}%`), { status: 502 });
  const d = (await fic.chiama('/issued_documents', {}, true, {
    type: 'invoice',
    entity: { ...(cliente.id ? { id: Number(cliente.id) } : {}), name: cliente.nome },
    date: data,
    use_gross_prices: !!lordo,
    ...(note ? { notes: note } : {}),
    items_list: righe.map(r => ({
      ...(r.codice ? { code: r.codice } : {}), name: r.nome, ...(r.descrizione ? { description: r.descrizione } : {}),
      qty: r.qta, ...(r.prezzo !== null && r.prezzo !== undefined ? { [lordo ? 'gross_price' : 'net_price']: r.prezzo } : {}),
      vat: { id: vat.id },
    })),
  })).data;
  return { id: String(d.id), numero: `${NOMI_TIPO.invoice} ${d.number ?? ''}${d.numeration || ''}`.trim(), url: d.url || '' };
}
