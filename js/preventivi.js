// Preventivi per beerfirm: voci, prezzi e formule copiati dal file Numbers "Americo" di Romain (ottobre 2026).
//   costo cotta = malti + luppoli + trasporto forniture + lievito e additivi + costi di produzione + accise
//   accise = ettolitri × °Plato × aliquota (1,49 € microbirrifici; nei fogli più vecchi 1,794)
//   preventivo = costo cotta + guadagno; prezzo al litro = preventivo / litri finali
//   prezzo di un formato = prezzo al litro × litri del formato + contenitore + lavoro
//     (lattina: litri 1/3 come nel foglio, lattina + cartone 0,20 €, lavoro 0,06 €; fusto 25 L +12,30 €; fusto 20 L +12 €)

export const SEZIONI = [
  { k: 'malti', titolo: 'Malti', qta: 'kg', prezzo: '€/kg' },
  { k: 'luppoli', titolo: 'Luppoli', qta: 'kg', prezzo: '€/kg' },
  { k: 'trasporto', titolo: 'Trasporto forniture', qta: 'qtà', prezzo: '€' },
  { k: 'lievito', titolo: 'Lievito e additivi', qta: 'qtà', prezzo: '€/unità' },
  { k: 'costi', titolo: 'Costi di produzione', qta: 'qtà', prezzo: '€/unità' },
];
export const STATI = [['bozza', 'Bozza'], ['inviato', 'Inviato'], ['accettato', 'Accettato'], ['rifiutato', 'Rifiutato']];
export const ALIQUOTA_ACCISE = 1.49;

const righe = l => l.map(([nome, qta, prezzo]) => ({ nome, qta, prezzo }));
const formati = (lattine, fusti25, fusti20 = 0) => [
  { nome: 'Lattine 0,33 L', litri: 1 / 3, contenitore: 0.2, lavoro: 0.06, qta: lattine },
  { nome: 'Fusti 25 L', litri: 25, contenitore: 12.3, lavoro: 0, qta: fusti25 },
  { nome: 'Fusti 20 L', litri: 20, contenitore: 12, lavoro: 0, qta: fusti20 },
];
const additivi = (polygel, extra = []) => [
  ['LP 652', 0, 776.6], ['zucchero', 0, 2.1], ['gypsum', 0.1, 4], ['Cloruro', 0.2, 4], ['magnesio', 0.2, 4],
  ['acido lattico', 0.5, 6], ['brewmix', 0.15, 46.22], ['spindasol', 0.33, 5.58], ['Protafloc', 0.05, 30],
  ['antioxin sbt', 0.1, 26.07], ['sale', 0, 1.15], ['coriandolo', 0, 7.7], ['Polygel', polygel, 26.2], ...extra,
];
const costi = (corrente, gas, affitto, rata, prezzoCorrente = 0.5) => [
  ['Acqua', 1, 10], ['Corrente (kWh)', corrente, prezzoCorrente], ['Gas', gas, 1.5], ['Affitto', 1, affitto],
  ['CO2', 1, 25], ['Detergenti', 1, 10], ['Rata', 1, rata], ['Lavoro', 1, 500],
];
const cambia = (lista, nome, qta) => lista.map(r => (r[0] === nome ? [r[0], qta, r[2]] : r));

// I fogli del file Americo. Dove il foglio aveva un totale scritto a mano (gas 15 € invece di 12 × 1,50) la quantità è sistemata per dare lo stesso totale.
export const MODELLI = [
  {
    id: 'cold-ipa', birra: 'Cold IPA', litri: 970, hl: 10, plato: 14, aliquota: 1.49, guadagno: 450,
    malti: [['Lola', 10, 0.42], ['PILS Dingemans', 150, 0.8], ['Carapils', 10, 1.5], ['Golden Promise', 45, 1.3], ['Oat naked', 7, 1.7], ['Vienna', 16, 1]],
    luppoli: [['Citra', 3, 36], ['Nectaron', 2.5, 36], ['Strata', 3, 36], ['Mosaic', 3, 36]],
    trasporto: 70,
    lievito: [['Lievito', 1, 100], ['LP 652', 0, 776.6], ['destrosio', 10, 1.59], ['gypsum', 0.1, 4], ['Cloruro', 0.1, 4], ['magnesio', 0.1, 4],
      ['acido lattico', 0.35, 6], ['brewmix', 0.1, 77], ['spindasol', 0.25, 7], ['Protafloc', 0.06, 30], ['antioxin sbt', 0.1, 26.07],
      ['bicarbonato', 0, 5.5], ['AMS', 0, 2.4], ['Polygel', 0.17, 26.2]],
    costi: costi(250, 12, 100, 383, 0.6),
    formati: formati(600, 31),
    note: 'Lattina 0,33 sleek nera 1,20 € compresa di lattina e cartone (no etichetta) e fusto 25 litri Dolium 80 €. Se vuoi Polykeg 1 € in più.',
  },
  {
    id: 'american-ipa-3', birra: 'American IPA 3', litri: 975, hl: 10, plato: 13.8, aliquota: 1.794, guadagno: 650,
    malti: [['Lola', 7, 0.42], ['PILS Monfarm', 247, 0.92], ['Vienna', 17, 1.08], ['Caramalt', 0, 1.32]],
    luppoli: [['Azacca', 2, 36.8], ['Citra Cryo', 1, 83], ['Citra', 3, 36.8], ['Nectaron Cryo', 3, 83]],
    trasporto: 100,
    lievito: [['Lievito', 1, 83], ...additivi(0.125)],
    costi: costi(300, 10, 70, 330),
    formati: formati(0, 39),
  },
  {
    id: 'american-ipa-2', birra: 'American IPA 2', litri: 975, hl: 10, plato: 13.4, aliquota: 1.794, guadagno: 650,
    malti: [['Lola', 7, 0.42], ['PILS Monfarm', 247, 0.92], ['Vienna', 17, 1.08], ['Caramalt', 0, 1.32]],
    luppoli: [['Azacca', 3, 36.8], ['Citra', 3, 36.8], ['Cryo', 5, 83]],
    trasporto: 100,
    lievito: [['Lievito', 1, 94], ...additivi(0.25)],
    costi: costi(250, 12, 90, 350),
    formati: formati(0, 39),
  },
  {
    id: 'american-ipa-1', birra: 'American IPA 1', litri: 991, hl: 10, plato: 13.4, aliquota: 1.794, guadagno: 700,
    malti: [['Lola', 7, 0.42], ['PILS Monfarm', 245, 1.02], ['Vienna', 19, 1.08], ['Caramalt', 0, 1.32]],
    luppoli: [['Azacca', 4, 36.8], ['Citra', 3, 36.8], ['Cryo', 2.5, 80]],
    trasporto: 100,
    lievito: [['Lievito', 1, 94], ...additivi(0.25)],
    costi: costi(250, 12, 90, 350),
    formati: formati(1488, 20),
  },
  {
    id: 'double-ipa-2', birra: 'Double IPA 2', litri: 981, hl: 10, plato: 15.7, aliquota: 1.794, guadagno: 650,
    malti: [['Lola', 8, 0.42], ['PILS Monfarm', 275, 0.94], ['Cara PILS', 0, 1.55], ['Caramalt', 25, 1.32]],
    luppoli: [['Citra Cryo', 2, 83.5], ['Citra', 1.5, 36.2], ['Galaxy', 5, 45.9], ['Nelson Sauvin', 2, 41.8], ['Herkules', 0.3, 17.6]],
    trasporto: 100,
    lievito: [['Lievito', 1, 90], ...cambia(cambia(cambia(additivi(0.125), 'zucchero', 25), 'gypsum', 0.2), 'acido lattico', 0.6)],
    costi: costi(300, 12, 70, 330),
    formati: formati(1080, 24),
  },
  {
    id: 'double-ipa-1', birra: 'Double IPA 1', litri: 981, hl: 10, plato: 15.7, aliquota: 1.794, guadagno: 700,
    malti: [['Lola', 8, 0.42], ['PILS Monfarm', 275, 0.94], ['Cara PILS', 0, 1.55], ['Caramalt', 25, 1.32]],
    luppoli: [['Citra Cryo', 2, 83.5], ['Citra', 1.5, 36.2], ['Galaxy', 4, 45.9], ['Nelson Sauvin', 2, 41.8], ['Nelson Sauvin Cryo', 2, 90.9]],
    trasporto: 100,
    lievito: [['Lievito', 1, 90], ...cambia(cambia(cambia(additivi(0.25), 'zucchero', 25), 'gypsum', 0.2), 'acido lattico', 0.6)],
    costi: costi(250, 12, 90, 266),
    formati: formati(1080, 24),
  },
  {
    id: 'rauch', birra: 'Rauch', litri: 1000, hl: 10, plato: 14, aliquota: 1.794, guadagno: 650,
    malti: [['Lola', 7, 0.42], ['PILS Monfarm', 58, 0.92], ['Munich Best', 85, 1.07], ['Weyermann Caramunich I', 10, 1.57], ['Chocolate', 6, 1.67], ['Smoked Weyermann', 100, 1.69]],
    luppoli: [['Perle', 1, 18.4], ['Magnum', 0.7, 17.4], ['Citra', 0, 36.8], ['Nectaron Cryo', 0, 83]],
    trasporto: 100,
    lievito: [['Lievito', 2, 66], ...additivi(0.125)],
    costi: costi(300, 10, 70, 330),
    formati: formati(0, 39),
  },
];
// nel foglio Cold IPA il Vienna era 16 kg × "1.2" scritto come testo, contato 16 €: qui 1 €/kg per avere lo stesso totale

export function daModello(m, id, oggi) {
  return {
    id, tipo: 'preventivo', cliente: '', birra: m.birra.replace(/ \d$/, ''), data: oggi, stato: 'bozza',
    litri: m.litri, hl: m.hl, plato: m.plato, aliquota: m.aliquota, guadagno: m.guadagno,
    malti: righe(m.malti), luppoli: righe(m.luppoli), trasporto: righe([['Trasporto forniture', 1, m.trasporto]]),
    lievito: righe(m.lievito), costi: righe(m.costi),
    formati: m.formati.map(f => ({ ...f })), note: m.note || '',
  };
}

const n = v => Number(v) || 0;
export function calcola(p) {
  const sezioni = {};
  for (const s of SEZIONI) {
    const r = (p[s.k] || []).map(x => n(x.qta) * n(x.prezzo));
    sezioni[s.k] = { righe: r, totale: r.reduce((a, b) => a + b, 0), qta: (p[s.k] || []).reduce((a, x) => a + n(x.qta), 0) };
  }
  const hlPlato = n(p.hl) * n(p.plato);
  const accise = hlPlato * n(p.aliquota);
  const totale = SEZIONI.reduce((a, s) => a + sezioni[s.k].totale, 0) + accise;
  const litri = n(p.litri);
  const costoL = litri ? totale / litri : 0;
  const preventivo = totale + n(p.guadagno);
  const prezzoL = litri ? preventivo / litri : 0;
  const formati = (p.formati || []).map(f => {
    const unita = prezzoL * n(f.litri) + n(f.contenitore) + n(f.lavoro);
    return { unita, totale: n(f.qta) * unita, litri: n(f.qta) * n(f.litri) };
  });
  const totalePreventivo = formati.reduce((a, f) => a + f.totale, 0);
  const litriConfezionati = formati.reduce((a, f) => a + f.litri, 0);
  return { sezioni, hlPlato, accise, totale, costoL, preventivo, prezzoL, formati, totalePreventivo, litriConfezionati };
}

const soldi = v => Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numero = v => Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 });
// testo da mandare al cliente: solo formati, prezzi unitari e totale (niente costi interni)
export function testoCliente(p, c, dataIT) {
  const usati = (p.formati || []).map((f, i) => ({ f, x: c.formati[i] })).filter(({ f }) => n(f.qta) > 0);
  return [
    `Preventivo ${p.birra || ''}`.trim(),
    [p.cliente && `Per: ${p.cliente}`, p.data && `Data: ${dataIT(p.data)}`].filter(Boolean).join(' · '),
    `Produzione: ${numero(p.litri)} litri`,
    '',
    ...usati.map(({ f, x }) => `- ${numero(f.qta)} × ${f.nome}: ${soldi(x.unita)} € cad. = ${soldi(x.totale)} €`),
    '',
    `Totale: ${soldi(c.totalePreventivo)} € + IVA`,
    ...(p.note ? ['', p.note] : []),
  ].join('\n');
}
