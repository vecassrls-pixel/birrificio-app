// Lettura da Fatture in Cloud (https://developers.fattureincloud.it), usata dal proxy dell'app
// (netlify/functions/fattureincloud.mjs) e dall'import automatico (netlify/lib/automazioni.mjs).
// Variabili d'ambiente Netlify: FIC_TOKEN, FIC_COMPANY_ID (facoltativo: altrimenti la prima azienda del token)

const BASE = 'https://api-v2.fattureincloud.it';
export const configurato = () => !!process.env.FIC_TOKEN;
export const NOMI_TIPO = { invoice: 'Fattura', delivery_note: 'DDT', receipt: 'Ricevuta', credit_note: 'Nota di credito' };

export async function client() {
  const token = process.env.FIC_TOKEN;
  let azienda = process.env.FIC_COMPANY_ID;
  const chiama = async (path, params = {}, conAzienda = true) => {
    const res = await fetch(`${BASE}${conAzienda ? `/c/${encodeURIComponent(azienda)}` : ''}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { const b = await res.json(); msg = b.error?.message || b.error?.validation_result?.toString() || msg; } catch { /* non JSON */ }
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
