// Tabella di ragguaglio del serbatoio acqua calda da 20 hL (Officine Mastromarino, matr. 9821).
// Indice = altezza in cm (tacca), valore = litri. A 14 cm c'è la saldatura della virola.
export const RAGGUAGLIO_HLT = [
  0, 0, 0, 1, 2, 3, 6, 10, 14, 20, 28, 37, 48, 61, 76, 152, 167, 182, 197, 213,
  228, 243, 258, 273, 288, 304, 319, 334, 349, 364, 380, 395, 410, 425, 440, 455, 471, 486, 501, 516,
  531, 546, 562, 577, 592, 607, 622, 638, 653, 668, 683, 698, 713, 729, 744, 759, 774, 789, 804, 820,
  835, 850, 865, 880, 895, 911, 926, 941, 956, 971, 987, 1002, 1017, 1032, 1047, 1062, 1078, 1093, 1108, 1123,
  1138, 1153, 1169, 1184, 1199, 1214, 1229, 1245, 1260, 1275, 1290, 1305, 1320, 1336, 1351, 1366, 1381, 1396, 1411, 1427,
  1442, 1457, 1472, 1487, 1502, 1518, 1533, 1548, 1563, 1578, 1594, 1609, 1624, 1639, 1654, 1669, 1685, 1700, 1715, 1730,
  1745, 1760, 1776, 1791, 1806, 1821, 1836, 1851, 1867, 1882, 1897, 1912, 1927, 1943, 1958, 1973, 1988, 2003, 2018, 2034,
  2049, 2064, 2079, 2094, 2109, 2125, 2140, 2155, 2170, 2185, 2201, 2216, 2231, 2246, 2261, 2276, 2292, 2307, 2322, 2337,
  2352, 2367, 2383, 2398, 2413,
];
export const ALTEZZA_MAX = RAGGUAGLIO_HLT.length - 1; // 164 cm

// litri a una certa tacca (accetta mezzi centimetri: interpola)
export function litriATacca(cm) {
  if (cm === null || cm === undefined || cm === '' || Number.isNaN(Number(cm))) return null;
  const h = Math.min(Math.max(Number(cm), 0), ALTEZZA_MAX);
  const i = Math.floor(h);
  if (i >= ALTEZZA_MAX) return RAGGUAGLIO_HLT[ALTEZZA_MAX];
  return RAGGUAGLIO_HLT[i] + (RAGGUAGLIO_HLT[i + 1] - RAGGUAGLIO_HLT[i]) * (h - i);
}

// tacca corrispondente a un volume (inversa, con interpolazione, arrotondata a 0,5 cm)
export function taccaPerLitri(litri) {
  if (litri === null || litri === undefined || litri <= 0) return 0;
  if (litri >= RAGGUAGLIO_HLT[ALTEZZA_MAX]) return ALTEZZA_MAX;
  let i = RAGGUAGLIO_HLT.findIndex(v => v >= litri);
  const a = RAGGUAGLIO_HLT[i - 1], b = RAGGUAGLIO_HLT[i];
  const h = i - 1 + (litri - a) / (b - a);
  return Math.round(h * 2) / 2;
}

// litri prelevati scendendo da una tacca all'altra
export function prelievo(daCm, aCm) {
  const a = litriATacca(daCm), b = litriATacca(aCm);
  return a === null || b === null ? null : Math.round(a - b);
}

// a che tacca fermarsi per prelevare `litri` partendo da `daCm`
export function taccaFinale(daCm, litri) {
  const start = litriATacca(daCm);
  return start === null ? null : taccaPerLitri(start - litri);
}
