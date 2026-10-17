// Lettore .xlsx minimo, senza librerie: valori delle celle (testo e numeri) di ogni foglio.
// Usa DecompressionStream del browser per lo zip. Le formule valgono il risultato salvato nel file.
// leggiXlsx(arrayBuffer) → [{ nome, righe: [[valore]] }]   (valore: stringa, numero o null)

const td = new TextDecoder();

async function voci(buf) {
  const v = new DataView(buf);
  let fine = buf.byteLength - 22;
  while (fine >= 0 && v.getUint32(fine, true) !== 0x06054b50) fine--;
  if (fine < 0) throw new Error('Il file non è un Excel (.xlsx)');
  const n = v.getUint16(fine + 10, true);
  let p = v.getUint32(fine + 16, true);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const metodo = v.getUint16(p + 10, true), dim = v.getUint32(p + 20, true);
    const lNome = v.getUint16(p + 28, true), lExtra = v.getUint16(p + 30, true), lComm = v.getUint16(p + 32, true);
    const locale = v.getUint32(p + 42, true);
    const nome = td.decode(new Uint8Array(buf, p + 46, lNome));
    const inizio = locale + 30 + v.getUint16(locale + 26, true) + v.getUint16(locale + 28, true);
    out.set(nome, { metodo, dati: new Uint8Array(buf, inizio, dim) });
    p += 46 + lNome + lExtra + lComm;
  }
  return out;
}
async function testo(voce) {
  if (!voce) return '';
  if (voce.metodo === 0) return td.decode(voce.dati);
  const s = new Blob([voce.dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return td.decode(await new Response(s).arrayBuffer());
}
const xml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c))).replace(/&amp;/g, '&');
const attr = (tag, nome) => tag.match(new RegExp(`\\b${nome}="([^"]*)"`))?.[1];
const indiceColonna = rif => { let n = 0; for (const ch of rif.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function leggiXlsx(buf) {
  const z = await voci(buf);
  const condivise = [...(await testo(z.get('xl/sharedStrings.xml'))).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => xml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const wb = await testo(z.get('xl/workbook.xml'));
  const rels = await testo(z.get('xl/_rels/workbook.xml.rels'));
  const dest = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const fogli = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const t = dest.get(attr(m[0], 'r:id')) || '';
    const percorso = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    const s = await testo(z.get(percorso));
    const righe = [];
    for (const r of s.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const riga = [];
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tipo = attr(c[1], 't'), rif = attr(c[1], 'r');
        const corpo = c[2] || '';
        const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let val = null;
        if (tipo === 's') val = condivise[Number(v)] ?? null;
        else if (tipo === 'inlineStr') val = xml([...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
        else if (tipo === 'str') val = v === undefined ? null : xml(v);
        else if (tipo === 'b') val = v === '1';
        else if (v !== undefined) val = Number(v);
        riga[rif ? indiceColonna(rif) : riga.length] = val;
      }
      const nr = Number(attr(r[0], 'r'));
      righe[nr ? nr - 1 : righe.length] = Array.from(riga, x => x ?? null);
    }
    fogli.push({ nome: xml(attr(m[0], 'name') || ''), righe: Array.from(righe, x => x || []) });
  }
  return fogli;
}

// numero di serie di Excel (giorni dal 30/12/1899) → AAAA-MM-GG
export const dataExcel = n => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000).toISOString().slice(0, 10);
