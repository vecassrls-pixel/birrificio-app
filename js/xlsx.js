// Scrittore .xlsx minimo, senza librerie: fogli con testo/numeri, colori di sfondo,
// grassetto, larghezza colonne e riquadri bloccati. Zip senza compressione.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colonna(n) { // 0 -> A, 26 -> AA
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// fogli: [{ nome, righe: [[cella]], larghezze: [n], blocca: { righe, colonne } }]
// cella: null | 'testo' | 123 | { v, sfondo: 'FFAA00', grassetto, colore: '000000', centro }
export function creaXlsx(fogli) {
  const stili = [{}];
  const chiaveStile = new Map([['{}', 0]]);
  const stileDi = c => {
    const s = { sfondo: c.sfondo || null, grassetto: !!c.grassetto, colore: c.colore || null, centro: !!c.centro };
    const k = JSON.stringify(s);
    if (!chiaveStile.has(k)) { chiaveStile.set(k, stili.length); stili.push(s); }
    return chiaveStile.get(k);
  };

  const xmlFogli = fogli.map(f => {
    const righe = f.righe.map((r, i) => {
      const celle = r.map((c, j) => {
        if (c === null || c === undefined || c === '') return '';
        const o = typeof c === 'object' ? c : { v: c };
        const rif = colonna(j) + (i + 1);
        const s = stileDi(o);
        const sa = s ? ` s="${s}"` : '';
        if (o.v === null || o.v === undefined || o.v === '') return `<c r="${rif}"${sa}/>`;
        if (typeof o.v === 'number' && Number.isFinite(o.v)) return `<c r="${rif}"${sa}><v>${o.v}</v></c>`;
        return `<c r="${rif}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
      }).join('');
      return `<row r="${i + 1}">${celle}</row>`;
    }).join('');
    const b = f.blocca || {};
    const vista = b.righe || b.colonne
      ? `<sheetViews><sheetView workbookViewId="0"><pane ${b.colonne ? `xSplit="${b.colonne}"` : ''} ${b.righe ? `ySplit="${b.righe}"` : ''} topLeftCell="${colonna(b.colonne || 0)}${(b.righe || 0) + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
      : '';
    const cols = (f.larghezze || []).length
      ? `<cols>${f.larghezze.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${vista}${cols}<sheetData>${righe}</sheetData></worksheet>`;
  });

  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const xfs = stili.map(s => {
    let fillId = 0, fontId = 0;
    if (s.sfondo) { fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${s.sfondo}"/><bgColor indexed="64"/></patternFill></fill>`); fillId = fills.length - 1; }
    if (s.grassetto || s.colore) { fonts.push(`<font>${s.grassetto ? '<b/>' : ''}<sz val="11"/>${s.colore ? `<color rgb="FF${s.colore}"/>` : ''}<name val="Calibri"/></font>`); fontId = fonts.length - 1; }
    const al = s.centro ? '<alignment horizontal="center"/>' : '';
    return `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${fillId ? ' applyFill="1"' : ''}${fontId ? ' applyFont="1"' : ''}${al ? ' applyAlignment="1"' : ''}>${al}</xf>`;
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const file = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${fogli.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${fogli.map((f, i) => `<sheet name="${esc(f.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fogli.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${fogli.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
  };
  xmlFogli.forEach((x, i) => { file[`xl/worksheets/sheet${i + 1}.xml`] = x; });
  return new Blob([zip(file)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- zip (solo "stored") ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function zip(file) {
  const enc = new TextEncoder();
  const parti = [], centrale = [];
  let offset = 0;
  for (const [nome, testo] of Object.entries(file)) {
    const n = enc.encode(nome), d = enc.encode(testo), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    parti.push(new Uint8Array(h.buffer), n, d);
    centrale.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const dimC = centrale.reduce((t, x) => t + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  const voci = Object.keys(file).length;
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, voci, true); e.setUint16(10, voci, true);
  e.setUint32(12, dimC, true); e.setUint32(16, offset, true);
  const tutto = [...parti, ...centrale, new Uint8Array(e.buffer)];
  const out = new Uint8Array(tutto.reduce((t, x) => t + x.length, 0));
  let p = 0; for (const x of tutto) { out.set(x, p); p += x.length; }
  return out;
}
