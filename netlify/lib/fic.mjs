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
  const chiama = async (path, params = {}, conAzienda = true, corpo = null, opzioni = null) => {
    const res = await fetch(`${BASE}${conAzienda ? `/c/${encodeURIComponent(azienda)}` : ''}${path}?${new URLSearchParams(params)}`, {
      method: corpo ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify({ data: corpo, ...(opzioni ? { options: opzioni } : {}) }) } : {}),
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

// Scadenze dei pagamenti per il cashflow (pagina #/cashflow): le rate (payments_list) delle fatture emesse,
// delle note di credito (nostre e dei fornitori) e dei documenti dei fornitori dal giorno `dal`. Si tengono le rate non pagate e quelle
// pagate dal giorno `pagateDal` (per le ultime settimane).
// → { voci: [{ id, verso: 'entrata'|'uscita', tipo, numero, data, controparte, importo, scadenza, pagata }], senzaRate, altri }
//   importo in euro, positivo; le note di credito sono negative: le nostre riducono quanto ci devono, quelle dei fornitori quanto dobbiamo.
const PAGINE_SCADENZE = 15;
async function documentiConRate(fic, path, params) {
  const docs = [];
  let altri = false;
  for (let pagina = 1; ; pagina++) {
    const r = await fic.chiama(path, { ...params, fieldset: 'detailed', sort: '-date', page: pagina, per_page: 100 });
    docs.push(...(r.data || []));
    if (pagina >= (r.last_page || 1)) break;
    if (pagina >= PAGINE_SCADENZE) { altri = true; break; }
  }
  // l'elenco a volte non porta le rate: si leggono uno per uno (al massimo 60, 6 alla volta)
  const mancanti = docs.map((d, i) => [d, i]).filter(([d]) => !Array.isArray(d.payments_list)).slice(0, 60);
  for (let i = 0; i < mancanti.length; i += 6) {
    await Promise.all(mancanti.slice(i, i + 6).map(async ([d, j]) => {
      docs[j] = (await fic.chiama(`${path}/${d.id}`, { fieldset: 'detailed' }).catch(() => null))?.data || d;
    }));
  }
  return { docs, altri };
}
export async function scadenze(fic, { dal, pagateDal }) {
  const q = { q: `date >= '${dal}'` };
  const [fatture, note, acquisti, noteFornitori] = await Promise.all([
    documentiConRate(fic, '/issued_documents', { ...q, type: 'invoice' }),
    documentiConRate(fic, '/issued_documents', { ...q, type: 'credit_note' }),
    documentiConRate(fic, '/received_documents', { ...q, type: 'expense' }),
    // note di credito dei fornitori (Romain 2026-10-30): riducono quanto dobbiamo pagare
    documentiConRate(fic, '/received_documents', { ...q, type: 'passive_credit_note' }).catch(() => ({ docs: [], altri: false })),
  ]);
  const voci = [];
  let senzaRate = 0;
  const aggiungi = (d, verso, tipo, segno, numero) => {
    const rate = Array.isArray(d.payments_list) ? d.payments_list : null;
    if (!rate || !rate.length) { senzaRate++; return; }
    rate.forEach((p, i) => {
      if (p.status === 'reversed') return;
      const pagata = p.status === 'paid' ? (p.paid_date || p.due_date || d.date) : null;
      if (pagata && pagata < pagateDal) return;
      const importo = Number(p.amount);
      if (!(importo > 0)) return;
      voci.push({
        id: `${tipo}-${d.id}-${i}`, verso, tipo, numero, data: d.date, controparte: d.entity?.name || '',
        importo: segno * importo, scadenza: p.due_date || d.date, pagata,
      });
    });
  };
  for (const d of fatture.docs) aggiungi(d, 'entrata', 'fattura', 1, `Fattura ${d.number ?? ''}${d.numeration || ''}`.trim());
  for (const d of note.docs) aggiungi(d, 'entrata', 'nota', -1, `Nota di credito ${d.number ?? ''}${d.numeration || ''}`.trim());
  for (const d of acquisti.docs) aggiungi(d, 'uscita', 'acquisto', 1, d.invoice_number ? `Fattura ${d.invoice_number}` : (d.description || 'Spesa'));
  for (const d of noteFornitori.docs) aggiungi(d, 'uscita', 'notaFornitore', -1, d.invoice_number ? `Nota di credito ${d.invoice_number}` : 'Nota di credito');
  return { voci, senzaRate, altri: fatture.altri || note.altri || acquisti.altri || noteFornitori.altri };
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
//   righe: [{ codice, nome, descrizione, qta, prezzo }],
//   accompagnatoria: { colli, peso, causale, destinazione, trasportatore } | null } → { id, numero, url }
// Il cliente con id prende tutti i dati dell'anagrafica (P.IVA, indirizzo, SDI); le righe con un codice
// si collegano al prodotto di Fatture in Cloud con quel codice.
const CAMPI_ENTITA = ['id', 'code', 'name', 'type', 'first_name', 'last_name', 'contact_person', 'vat_number', 'tax_code', 'address_street', 'address_postal_code', 'address_city', 'address_province', 'address_extra', 'country', 'country_iso', 'email', 'certified_email', 'phone', 'e_invoice', 'ei_code'];
export async function creaFattura(fic, { data, cliente, righe, lordo = false, aliquota = 22, note = '', accompagnatoria = null }) {
  const iva = (await fic.chiama('/info/vat_types')).data || [];
  const vat = iva.find(v => Number(v.value) === Number(aliquota) && !v.is_disabled && !v.e_invoice) || iva.find(v => Number(v.value) === Number(aliquota) && !v.is_disabled);
  if (!vat) throw Object.assign(new Error(`Fatture in Cloud: non trovo l'aliquota IVA ${aliquota}%`), { status: 502 });
  let entity = { name: cliente.nome };
  if (cliente.id) {
    const c = (await fic.chiama(`/entities/clients/${encodeURIComponent(cliente.id)}`, { fieldset: 'detailed' })).data || {};
    entity = Object.fromEntries(CAMPI_ENTITA.filter(k => c[k] !== undefined && c[k] !== null && c[k] !== '').map(k => [k, c[k]]));
    entity.id = Number(cliente.id);
    entity.name ||= cliente.nome;
  }
  const perCodice = new Map();
  if (righe.some(r => r.codice)) for (const p of await prodotti(fic).catch(() => [])) if (p.codice) perCodice.set(p.codice.trim().toLowerCase(), p);
  const doc = {
    type: 'invoice',
    entity,
    date: data,
    use_gross_prices: !!lordo,
    ...(note ? { notes: note } : {}),
    ...(accompagnatoria ? {
      accompanying_invoice: true,
      ...(accompagnatoria.colli ? { dn_ai_packages_number: String(accompagnatoria.colli) } : {}),
      ...(accompagnatoria.peso ? { dn_ai_weight: String(accompagnatoria.peso) } : {}),
      dn_ai_causal: accompagnatoria.causale || 'Vendita',
      ...(accompagnatoria.destinazione ? { dn_ai_destination: accompagnatoria.destinazione } : {}),
      ...(accompagnatoria.trasportatore ? { dn_ai_transporter: accompagnatoria.trasportatore } : {}),
    } : {}),
    items_list: righe.map(r => ({
      ...(r.codice && perCodice.get(r.codice.toLowerCase()) ? { product_id: Number(perCodice.get(r.codice.toLowerCase()).id) } : {}),
      ...(r.codice ? { code: perCodice.get(r.codice.toLowerCase())?.codice || r.codice } : {}),
      name: perCodice.get(r.codice?.toLowerCase())?.nome || r.nome, ...(r.descrizione ? { description: r.descrizione } : {}),
      qty: r.qta, ...(r.prezzo !== null && r.prezzo !== undefined ? { [lordo ? 'gross_price' : 'net_price']: r.prezzo } : {}),
      vat: { id: vat.id },
    })),
  };
  // un pagamento unico non pagato pari al totale, come fa Fatture in Cloud a mano: senza, i pagamenti predefiniti
  // del cliente non tornano con il totale (errore 422 "Il totale dei pagamenti non corrisponde al totale da pagare")
  const tot = (await fic.chiama('/issued_documents/totals', {}, true, doc).catch(() => null))?.data || {};
  const dovuto = Number(tot.amount_due ?? tot.amount_gross);
  if (dovuto > 0) doc.payments_list = [{ amount: dovuto, due_date: data, status: 'not_paid' }];
  const d = (await fic.chiama('/issued_documents', {}, true, doc, { fix_payments: true })).data;
  return { id: String(d.id), numero: `${NOMI_TIPO.invoice} ${d.number ?? ''}${d.numeration || ''}`.trim(), url: d.url || '' };
}
