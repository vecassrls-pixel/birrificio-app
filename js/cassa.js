// Prima nota di cassa (contanti): entrate e uscite, conte della cassa, saldo.
// Sostituisce il foglio "Cassa Vecas". Senza DOM: lo usano la pagina Cassa e i test.
//
// Record:
//   movcassa   { data, descrizione, entrata, uscita, categoria, note, rifMovBirra? }  (entrata o uscita, in euro)
//   contacassa { data, saldo, note }   contanti contati a fine giornata (o riporto di inizio anno):
//              il saldo riparte da lì, e la differenza con il calcolato si vede nell'elenco.

import { dataExcel } from './xlsx-leggi.js';

export const CATEGORIE_CASSA = {
  vendite: 'Vendite', taproom: 'Taproom', incasso: 'Incasso cliente', versamento: 'Versamento in banca',
  spesa: 'Spesa', rimborso: 'Rimborso', stipendio: 'Stipendio', altro: 'Altro',
};
// categoria proposta dalla descrizione
export function categoriaCassa(descrizione, entrata) {
  const d = String(descrizione || '').toLowerCase();
  if (/taproom/.test(d)) return 'taproom';
  if (/versat|versament/.test(d)) return 'versamento';
  if (/rimbors/.test(d)) return 'rimborso';
  if (/stipend/.test(d)) return 'stipendio';
  if (/vendit/.test(d)) return 'vendite';
  return entrata ? 'incasso' : 'spesa';
}
const n = v => Number(v) || 0;
export const importo = m => n(m.entrata) - n(m.uscita);

// Saldo fino a una data (compresa): ultima conta fino a quel giorno + movimenti dopo la conta.
export function saldoCassa(movimenti, conte, fino = '9999-12-31') {
  const conta = conte.filter(c => !c.eliminato && c.data && c.data <= fino).sort((a, b) => a.data.localeCompare(b.data)).pop() || null;
  const da = conta?.data || '';
  const saldo = (conta ? n(conta.saldo) : 0) + movimenti.filter(m => !m.eliminato && m.data && m.data > da && m.data <= fino).reduce((t, m) => t + importo(m), 0);
  return { saldo, conta };
}

// Elenco con il saldo progressivo, dal più vecchio; le conte compaiono come righe con la differenza.
export function registroCassa(movimenti, conte) {
  const righe = [
    ...movimenti.filter(m => !m.eliminato && m.data).map(m => ({ tipo: 'mov', data: m.data, m })),
    ...conte.filter(c => !c.eliminato && c.data).map(c => ({ tipo: 'conta', data: c.data, c })),
  ].sort((a, b) => a.data.localeCompare(b.data) || (a.tipo === 'conta') - (b.tipo === 'conta') || String(a.m?.creato || '').localeCompare(String(b.m?.creato || '')));
  let saldo = 0;
  for (const r of righe) {
    if (r.tipo === 'mov') { saldo += importo(r.m); r.saldo = saldo; } else { r.differenza = n(r.c.saldo) - saldo; saldo = n(r.c.saldo); r.saldo = saldo; }
  }
  return righe;
}

// Import dal foglio Excel della cassa (esportato da Numbers): fogli "Cassa …" con le colonne
// Descrizione, data, avere (entrata), dare (uscita), da pagare (la riga RIPORTO ha il saldo di inizio anno).
// Le righe senza data prendono la data della riga prima. Ritorna { fogli: [{ nome, movimenti, conta }] }.
export function cassaDaExcel(fogli) {
  const out = [];
  for (const f of fogli) {
    const iTesta = f.righe.findIndex(r => r.some(c => String(c ?? '').trim().toLowerCase() === 'descrizione'));
    if (iTesta < 0) continue;
    const testa = f.righe[iTesta].map(c => String(c ?? '').trim().toLowerCase());
    const col = nome => testa.indexOf(nome);
    const [cD, cData, cAvere, cDare, cRip] = [col('descrizione'), col('data'), col('avere'), col('dare'), col('da pagare')];
    if (cD < 0 || cAvere < 0 || cDare < 0) continue;
    const anno = Number(f.nome.match(/(20\d\d)\s*$/)?.[1]) || null;
    const movimenti = [];
    let conta = null, ultima = null;
    const daCella = v => {
      if (typeof v === 'number' && v > 20000 && v < 80000) return dataExcel(v);
      const m = String(v ?? '').match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    };
    for (const r of f.righe.slice(iTesta + 1)) {
      const desc = String(r[cD] ?? '').trim();
      if (/^riporto$/i.test(desc)) { const s = Number(r[cRip] ?? r[cAvere] ?? r[cDare]); if (Number.isFinite(s) && anno) conta = { data: `${anno - 1}-12-31`, saldo: s, note: `Riporto da "${f.nome}"` }; continue; }
      if (/^(totale|in cassa)$/i.test(desc)) break;
      const entrata = typeof r[cAvere] === 'number' ? r[cAvere] : null, uscita = typeof r[cDare] === 'number' ? r[cDare] : null;
      if (!entrata && !uscita) continue;
      const data = (cData >= 0 && daCella(r[cData])) || ultima || (anno ? `${anno}-01-01` : null);
      if (!data) continue;
      ultima = data;
      movimenti.push({ data, descrizione: desc || '(senza descrizione)', entrata: entrata || null, uscita: uscita || null, categoria: categoriaCassa(desc, entrata) });
    }
    if (movimenti.length) out.push({ nome: f.nome, movimenti, conta });
  }
  return out;
}
