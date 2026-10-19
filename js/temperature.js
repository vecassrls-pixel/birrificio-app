// Temperature dei fermentatori: dati dal gateway in birrificio (tools/gateway-temperature) via Supabase.
//   temperature_attuali   ultimo valore per FV (pagina Cantina, in tempo reale)
//   letture_temperature   storico ogni 5 minuti (curva nella scheda cotta e nel PDF)
//   sensori               soglie di allarme per FV
// Le tabelle si creano con supabase/migrazione_temperature.sql. Senza tabelle, senza internet o in modalità
// solo locale l'app funziona lo stesso: si vedono l'ultimo stato salvato o un avviso.

import * as db from './db.js';
import { interroga } from './sync.js';
import { addGiorni, daISO, diffGiorni, oggiISO, periodiCotta, registroComune, gruppoCotta } from './dominio.js';

export const FV_CANTINA = Array.from({ length: 11 }, (_, i) => `FV${i + 1}`);
// Celle frigo e frigo luppoli (unghia "Celle" della Cantina): stesse tabelle, codice al posto del nome del FV
export const CELLE = [
  { id: 'CELLA1', nome: 'Cella 1', forma: 'cella' },
  { id: 'CELLA2', nome: 'Cella 2', forma: 'cella' },
  { id: 'FRIGO-LUPPOLI', nome: 'Frigo luppoli', forma: 'frigo' },
];
export const eCella = id => CELLE.some(c => c.id === id);
export const SOGLIE_DEFAULT = { soglia_scostamento: 1.5, minuti_offline: 10, temp_min: null, temp_max: null };
const pieno = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

// ---------- stato attuale ----------
// { sensori: Map fv → riga, attuali: Map fv → riga, salvato: ISO | null (copia locale se offline) }
export async function caricaAttuali() {
  try {
    const [sensori, attuali] = await Promise.all([interroga('sensori?select=*'), interroga('temperature_attuali?select=*')]);
    db.meta('temperatureAttuali', { sensori, attuali, salvato: new Date().toISOString() }).catch(() => {});
    return { sensori: perFv(sensori), attuali: perFv(attuali), salvato: null };
  } catch (e) {
    // senza internet: l'ultimo stato visto su questo dispositivo, segnato come vecchio
    const copia = e.codice === 'offline' ? await db.meta('temperatureAttuali').catch(() => null) : null;
    if (copia) return { sensori: perFv(copia.sensori), attuali: perFv(copia.attuali), salvato: copia.salvato, errore: e };
    return { sensori: new Map(), attuali: new Map(), salvato: null, errore: e };
  }
}
const perFv = righe => new Map((righe || []).map(r => [r.fv, r]));

// Allarmi di una scheda: sensore muto (dati vecchi), errore della sonda, fuori setpoint, fuori dai limiti
export function statoFv(att, sensore, adesso = Date.now()) {
  const s = { ...SOGLIE_DEFAULT, ...Object.fromEntries(Object.entries(sensore || {}).filter(([, v]) => v !== null && v !== undefined)) };
  if (sensore && sensore.attivo === false) return { livello: 'spento', motivi: ['sensore disattivato'] };
  if (!att) return { livello: 'nessuno', motivi: [] };
  const motivi = [];
  const minuti = (adesso - new Date(att.ts).getTime()) / 60_000;
  const muto = !(minuti <= Number(s.minuti_offline));
  if (muto) motivi.push(`nessun dato da ${durata(minuti)}`);
  if (att.errore) motivi.push(att.errore);
  const t = pieno(att.temperatura) ? Number(att.temperatura) : null;
  if (t !== null && pieno(att.setpoint) && Math.abs(t - Number(att.setpoint)) > Number(s.soglia_scostamento)) {
    motivi.push(`${t > att.setpoint ? '+' : '−'}${fmt(Math.abs(t - att.setpoint))} °C dal setpoint`);
  }
  if (t !== null && pieno(s.temp_min) && t < Number(s.temp_min)) motivi.push(`sotto ${fmt(s.temp_min)} °C`);
  if (t !== null && pieno(s.temp_max) && t > Number(s.temp_max)) motivi.push(`sopra ${fmt(s.temp_max)} °C`);
  return { livello: muto ? 'muto' : motivi.length ? 'allarme' : 'ok', motivi, minuti };
}

export function durata(minuti) {
  if (!Number.isFinite(minuti)) return '—';
  if (minuti < 1) return 'meno di un minuto';
  if (minuti < 60) return `${Math.round(minuti)} min`;
  if (minuti < 48 * 60) return `${Math.round(minuti / 60)} h`;
  return `${Math.round(minuti / 1440)} giorni`;
}
export const fmt = (v, d = 1) => Number(v).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- cotta nel FV ----------
// Per ogni FV la cotta che lo occupa oggi (con il travaso è nel secondo FV), come nella Home.
export function cottePerFv(cotte, durate, fvs, oggi = oggiISO()) {
  const out = new Map();
  for (const c of cotte) {
    if (c.eliminato) continue;
    for (const p of periodiCotta(c, durate, fvs)) {
      if (!p.fv || p.da > oggi || p.a < oggi) continue;
      const x = out.get(p.fv) || { cotte: [], periodo: p };
      if (!x.cotte.some(y => y.id === c.id)) x.cotte.push(c);
      out.set(p.fv, x);
    }
  }
  for (const x of out.values()) x.cotte.sort((a, b) => a.data.localeCompare(b.data));
  return out;
}

// Temperatura prevista oggi dal registro di fermentazione (profilo): l'ultima scritta fino a oggi
export function profiloOggi(c, cotte, oggi = oggiISO()) {
  const reg = registroComune(gruppoCotta(c, cotte)).filter(e => e.data && e.data <= oggi && pieno(e.temp));
  return reg.length ? Number(reg[reg.length - 1].temp) : null;
}

// ---------- curva della cotta ----------
// Intervalli di tempo e FV occupati dalla cotta (anche dopo il travaso), fino ad adesso.
const mezzanotte = iso => daISO(iso).getTime();
export function intervalliCotta(c, durate, fvs, adesso = Date.now()) {
  return periodiCotta(c, durate, fvs)
    .filter(p => p.fv)
    .map(p => ({ fv: p.fv, travaso: !!p.travaso, da: mezzanotte(p.da), a: Math.min(mezzanotte(addGiorni(p.a, 1)), adesso), giorni: diffGiorni(p.da, p.a) + 1 }))
    .filter(p => p.a > p.da);
}

// passo delle medie: circa 400 punti per tutta la cotta, al massimo una media ogni 6 ore
const PASSI = [15, 30, 60, 120, 180, 360];
export const passoMinuti = ms => PASSI.find(p => ms / 60_000 / p <= 400) || PASSI[PASSI.length - 1];

const cache = new Map(); // chiave → { quando, dati }
export async function caricaCurva(intervalli) {
  if (!intervalli.length) return { punti: [], passo: 60 };
  const tot = intervalli.reduce((t, p) => t + (p.a - p.da), 0);
  const passo = passoMinuti(tot);
  const chiave = intervalli.map(p => `${p.fv}:${p.da}:${Math.floor(p.a / 600_000)}`).join('|');
  const c = cache.get(chiave);
  if (c && Date.now() - c.quando < 5 * 60_000) return c.dati;
  const dati = [];
  for (const p of intervalli) {
    const righe = await interroga('rpc/temperature_medie', { method: 'POST', body: { p_fv: p.fv, p_da: new Date(p.da).toISOString(), p_a: new Date(p.a).toISOString(), p_minuti: passo } });
    dati.push(...righe.map(r => ({
      t: new Date(r.ts).getTime() + passo * 30_000, // centro dell'intervallo
      fv: p.fv,
      temp: pieno(r.temperatura) ? Number(r.temperatura) : null,
      sp: pieno(r.setpoint) ? Number(r.setpoint) : null,
      freddo: pieno(r.raffreddamento_pct) ? Number(r.raffreddamento_pct) : null,
    })));
  }
  dati.sort((a, b) => a.t - b.t);
  const out = { punti: dati, passo };
  cache.set(chiave, { quando: Date.now(), dati: out });
  return out;
}

// ---------- grafico SVG ----------
const W = typeof innerWidth === 'number' && innerWidth < 600 ? 400 : 760, SX = 40, DX = 14, TOP = 14, H = 170, FREDDO_H = 10;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const dataOra = t => new Date(t).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const giornoMese = t => new Date(t).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });

// punti: [{ t, temp, sp, freddo, fv }], intervalli: da intervalliCotta, profilo: [{ t, temp }] dal registro della cotta
export function graficoTemperature({ punti, passo }, intervalli, profilo = [], id = 'graf-temp') {
  const conT = punti.filter(p => p.temp !== null);
  if (conT.length < 2) return '';
  const t0 = intervalli[0].da, t1 = Math.max(intervalli[intervalli.length - 1].a, conT[conT.length - 1].t);
  const prof = profilo.filter(p => p.t >= t0 && p.t <= t1);
  const valori = [...conT.map(p => p.temp), ...punti.filter(p => p.sp !== null).map(p => p.sp), ...prof.map(p => p.temp)];
  let lo = Math.floor(Math.min(...valori)), hi = Math.ceil(Math.max(...valori));
  if (hi - lo < 6) { const m = (hi + lo) / 2; lo = Math.floor(m - 3); hi = Math.ceil(m + 3); }
  const fondo = TOP + H, bandaFreddo = fondo + 6, altezza = bandaFreddo + FREDDO_H + 22;
  const x = t => SX + (t - t0) / (t1 - t0) * (W - SX - DX);
  const y = v => fondo - (v - lo) / (hi - lo) * H;
  let svg = '';
  // griglia orizzontale e gradi a sinistra
  const passoY = (hi - lo) / 4;
  for (let i = 0; i <= 4; i++) {
    const v = lo + i * passoY, yy = y(v);
    svg += `<line x1="${SX}" x2="${W - DX}" y1="${yy}" y2="${yy}" class="gf-griglia"/><text x="${SX - 5}" y="${yy + 4}" class="gf-asse" text-anchor="end">${fmt(v, passoY % 1 ? 1 : 0)}°</text>`;
  }
  // giorni: al massimo ~8 etichette
  const giorni = Math.max(1, Math.round((t1 - t0) / 86_400_000));
  const ogni = [1, 2, 3, 5, 7, 10, 14].find(n => giorni / n <= 8) || 21;
  for (let g = 0; g <= giorni; g += ogni) {
    const t = t0 + g * 86_400_000;
    if (t > t1) break;
    svg += `<line x1="${x(t)}" x2="${x(t)}" y1="${TOP}" y2="${fondo}" class="gf-griglia"/><text x="${x(t)}" y="${altezza - 4}" class="gf-asse" text-anchor="${g === 0 ? 'start' : 'middle'}">${giornoMese(t)}</text>`;
  }
  // travaso: linea verticale con il FV di arrivo
  for (const p of intervalli.filter(q => q.travaso)) {
    svg += `<line x1="${x(p.da)}" x2="${x(p.da)}" y1="${TOP - 4}" y2="${fondo}" class="tg-travaso"/><text x="${x(p.da) + 4}" y="${TOP + 8}" class="gf-asse">travaso → ${esc(p.fv)}</text>`;
  }
  // freddo acceso: striscia sotto il grafico, più scura quando è acceso più a lungo
  const larg = Math.max(1, (W - SX - DX) * passo * 60_000 / (t1 - t0));
  let freddo = '';
  for (const p of punti) if (p.freddo > 0) freddo += `<rect x="${x(p.t) - larg / 2}" y="${bandaFreddo}" width="${larg}" height="${FREDDO_H}" opacity="${(0.25 + 0.75 * p.freddo / 100).toFixed(2)}"/>`;
  const conFreddo = punti.some(p => p.freddo !== null);
  if (conFreddo) svg += `<rect x="${SX}" y="${bandaFreddo}" width="${W - SX - DX}" height="${FREDDO_H}" class="tg-freddo-fondo"/><g class="tg-freddo">${freddo}</g>`;
  // linee: si interrompono dove mancano dati (gateway spento, internet assente senza buffer)
  const buco = passo * 60_000 * 3;
  const linea = (pts, k, gradini) => {
    let d = '', prec = null;
    for (const p of pts) {
      const v = p[k];
      if (v === null) { prec = null; continue; }
      if (!prec || p.t - prec.t > buco || p.fv !== prec.fv) d += `M${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      else d += gradini ? `H${x(p.t).toFixed(1)}V${y(v).toFixed(1)}` : `L${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      prec = p;
    }
    return d;
  };
  if (prof.length) {
    let d = '';
    prof.forEach((p, i) => { d += i ? `H${x(p.t).toFixed(1)}V${y(p.temp).toFixed(1)}` : `M${x(p.t).toFixed(1)},${y(p.temp).toFixed(1)}`; });
    d += `H${x(Math.min(t1, prof[prof.length - 1].t + 86_400_000)).toFixed(1)}`;
    svg += `<path d="${d}" class="tg-profilo"/>`;
  }
  const conSp = punti.some(p => p.sp !== null);
  if (conSp) svg += `<path d="${linea(punti, 'sp', true)}" class="tg-setpoint"/>`;
  svg += `<path d="${linea(punti, 'temp', false)}" class="tg-temp"/>`;
  // legenda: ogni serie con il suo segno, il testo resta nel colore del testo
  const ult = conT[conT.length - 1];
  const voci = [
    ['tg-l-temp', `Temperatura (ultima ${fmt(ult.temp)} °C)`],
    ...(conSp ? [['tg-l-setpoint', 'Setpoint']] : []),
    ...(prof.length ? [['tg-l-profilo', 'Profilo previsto']] : []),
    ...(conFreddo ? [['tg-l-freddo', 'Freddo acceso']] : []),
  ];
  const leg = voci.map(([cl, testo]) => `<span><i class="tg-segno ${cl}"></i>${esc(testo)}</span>`).join('');
  return `<div class="graf-ferm graf-temp" id="${id}" data-t0="${t0}" data-t1="${t1}">
    <div class="tg-legenda">${leg}</div>
    <svg viewBox="0 0 ${W} ${altezza}" role="img" aria-label="Temperatura misurata nel fermentatore dal ${esc(giornoMese(t0))} al ${esc(giornoMese(t1))}">
      ${svg}<line class="gf-croce" x1="0" x2="0" y1="${TOP}" y2="${bandaFreddo + FREDDO_H}" visibility="hidden"/>
      <rect x="${SX}" y="0" width="${W - SX - DX}" height="${altezza}" fill="transparent" class="tg-area"/>
    </svg>
    <div class="gf-tip" hidden></div>
  </div>`;
}

// crocino e valori del punto più vicino
export function attivaGraficoTemp(box, punti) {
  if (!box) return;
  const svg = box.querySelector('svg'), croce = box.querySelector('.gf-croce'), tip = box.querySelector('.gf-tip');
  const t0 = Number(box.dataset.t0), t1 = Number(box.dataset.t1);
  const conT = punti.filter(p => p.temp !== null);
  const muovi = ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const t = t0 + (px - SX) / (W - SX - DX) * (t1 - t0);
    const p = conT.reduce((m, q) => (Math.abs(q.t - t) < Math.abs(m.t - t) ? q : m), conT[0]);
    const xs = SX + (p.t - t0) / (t1 - t0) * (W - SX - DX);
    croce.setAttribute('x1', xs); croce.setAttribute('x2', xs); croce.setAttribute('visibility', 'visible');
    tip.innerHTML = `<div class="gf-tip-testa">${esc(dataOra(p.t))} · ${esc(p.fv)}</div>
      <div><i class="gf-pallino tg-p-temp"></i><span>Temperatura</span> <b>${fmt(p.temp)} °C</b></div>
      ${p.sp !== null ? `<div><i class="gf-pallino tg-p-setpoint"></i><span>Setpoint</span> <b>${fmt(p.sp)} °C</b></div>` : ''}
      ${p.freddo !== null ? `<div><i class="gf-pallino tg-p-freddo"></i><span>Freddo acceso</span> <b>${Math.round(p.freddo)}%</b></div>` : ''}`;
    tip.hidden = false;
    const left = xs / W * r.width;
    tip.style.left = `${Math.min(Math.max(left + 12, 0), r.width - tip.offsetWidth)}px`;
    if (left + 12 + tip.offsetWidth > r.width) tip.style.left = `${Math.max(left - tip.offsetWidth - 12, 0)}px`;
  };
  const via = () => { croce.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('mousemove', muovi);
  svg.addEventListener('touchmove', muovi, { passive: true });
  svg.addEventListener('touchstart', muovi, { passive: true });
  svg.addEventListener('mouseleave', via);
}

// Profilo previsto (registro di fermentazione) come punti a mezzanotte di ogni giorno
export function profiloCotta(c, cotte) {
  return registroComune(gruppoCotta(c, cotte))
    .filter(e => e.data && pieno(e.temp))
    .map(e => ({ t: mezzanotte(e.data), temp: Number(e.temp) }));
}
