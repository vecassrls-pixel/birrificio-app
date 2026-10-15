// Grafico riassuntivo della fermentazione: temperatura, °Plato e pH giorno per giorno.
// Un solo grafico (Romain 2026-10-12): le tre linee sulla stessa griglia, ognuna col suo colore
// e la sua scala (T° a sinistra, °P a destra, pH con i valori sulla linea).
// Passando col dito o il mouse compaiono i valori di quel giorno.

// su telefono il disegno è più stretto, così testi e punti restano leggibili
const W = typeof innerWidth === 'number' && innerWidth < 600 ? 400 : 760, SX = 40, DX = 40, H = 200, TOP = 30;
const SERIE = [
  ['temp', 'Temperatura', '°C', 1],
  ['densita', 'Densità', '°P', 1],
  ['ph', 'pH', '', 2],
];
const pieno = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const fmt = (v, d) => Number(v).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d });

// punti per giorno (1 = giorno di cotta) dal registro di fermentazione.
// Il giorno 1 prende i valori della scheda cotta: OG (per le cotte doppie la media), T° d'inoculo e pH.
export function puntiFermentazione(c, diffGiorni, cotta = {}) {
  const punti = (c.fermentazione || [])
    .map((e, i) => ({ g: c.data && e.data ? diffGiorni(c.data, e.data) + 1 : e.giorno || i + 1, e }))
    .filter(p => p.g > 0)
    .sort((a, b) => a.g - b.g);
  const v = Object.fromEntries(Object.entries(cotta).filter(([, x]) => pieno(x)).map(([k, x]) => [k, Number(x)]));
  if (!Object.keys(v).length) return punti;
  const daCotta = Object.keys(v);
  const primo = punti.find(p => p.g === 1);
  if (primo) primo.e = { ...primo.e, ...v, daCotta };
  else punti.unshift({ g: 1, e: { data: c.data, ...v, daCotta } });
  return punti;
}

// Scale fisse per ogni misura (allargate se un valore esce): con scale "dal minimo al massimo" le tre linee,
// che di solito scendono tutte, finivano una sopra l'altra e il pH copriva la densità (Romain 2026-10-15).
const LIMITI = { temp: [0, 25], densita: [0, 20], ph: [3.5, 6] };
function scala(k, valori) {
  const [a, b] = LIMITI[k];
  const lo = Math.min(a, ...valori), hi = Math.max(b, ...valori);
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

export function graficoFermentazione(c, diffGiorni, oggiG, cotta = {}) {
  const punti = puntiFermentazione(c, diffGiorni, cotta);
  const usate = SERIE.filter(([k]) => punti.filter(p => pieno(p.e[k])).length >= 1);
  if (punti.length < 2 || !usate.length) return '';
  const g0 = punti[0].g, g1 = Math.max(punti[punti.length - 1].g, g0 + 1);
  const x = g => SX + (g - g0) / (g1 - g0) * (W - SX - DX);
  const fondo = TOP + H, altezza = fondo + 22;
  // tacche dei giorni: ogni 7 giorni
  const tacche = [];
  for (let g = g0; g <= g1; g++) if (g === g0 || g % 7 === 0) tacche.push(g);
  // griglia comune: 5 righe orizzontali + giorni
  let svg = '';
  for (let i = 0; i <= 4; i++) { const yy = TOP + i * H / 4; svg += `<line x1="${SX}" x2="${W - DX}" y1="${yy}" y2="${yy}" class="gf-griglia"/>`; }
  for (const g of tacche) svg += `<line x1="${x(g)}" x2="${x(g)}" y1="${TOP}" y2="${fondo}" class="gf-griglia"/><text x="${x(g)}" y="${fondo + 16}" class="gf-asse" text-anchor="middle">g${g}</text>`;
  if (oggiG >= g0 && oggiG <= g1) svg += `<line x1="${x(oggiG)}" x2="${x(oggiG)}" y1="${TOP}" y2="${fondo}" class="gf-oggi"/>`;
  // legenda in alto con l'ultimo valore di ogni misura
  let lx = 0;
  usate.forEach(([k, titolo, unita, dec]) => {
    const pts = punti.filter(p => pieno(p.e[k])).map(p => ({ g: p.g, v: Number(p.e[k]) }));
    const [lo, hi] = scala(k, pts.map(p => p.v));
    const y = v => fondo - (v - lo) / (hi - lo) * H;
    const ult = pts[pts.length - 1];
    const testo = `${titolo} ${fmt(ult.v, dec)}${unita ? ` ${unita}` : ''}`;
    svg += `<g class="gf-${k}"><circle cx="${lx + 5}" cy="12" r="5" class="gf-punto"/><text x="${lx + 14}" y="16" class="gf-titolo">${testo}</text></g>`;
    lx += 26 + testo.length * 6.6;
    // scala: T° a sinistra, °P a destra (min e max misurati), pH scritto sulla linea
    const vv = [...new Set([Math.min(...pts.map(p => p.v)), Math.max(...pts.map(p => p.v))])];
    if (k === 'temp') for (const v of vv) svg += `<text x="${SX - 5}" y="${y(v) + 4}" class="gf-asse gf-${k}" text-anchor="end">${fmt(v, dec)}°</text>`;
    if (k === 'densita') for (const v of vv) svg += `<text x="${W - DX + 5}" y="${y(v) + 4}" class="gf-asse gf-${k}">${fmt(v, dec)}</text>`;
    // temperatura: impostata e mantenuta, quindi a gradini; °P e pH: misure collegate
    let d = '';
    pts.forEach((p, i) => {
      if (i === 0) d = `M${x(p.g)},${y(p.v)}`;
      else d += k === 'temp' ? `H${x(p.g)}V${y(p.v)}` : `L${x(p.g)},${y(p.v)}`;
    });
    svg += `<g class="gf-${k}"><path d="${d}" class="gf-linea"/>`;
    // punti solo dove c'è una misura (per la temperatura: dove cambia)
    pts.forEach((p, i) => {
      if (k === 'temp' && i > 0 && i < pts.length - 1 && pts[i - 1].v === p.v) return;
      svg += `<circle cx="${x(p.g)}" cy="${y(p.v)}" r="3.5" class="gf-punto"/>`;
    });
    if (k === 'ph') for (const p of [pts[0], ...(pts.length > 1 ? [ult] : [])]) svg += `<text x="${x(p.g)}" y="${y(p.v) - 8}" class="gf-val" text-anchor="${p === ult && x(p.g) > W - 60 ? 'end' : 'middle'}">${fmt(p.v, dec)}</text>`;
    svg += '</g>';
  });
  return `<div class="graf-ferm" id="graf-ferm" data-g0="${g0}" data-g1="${g1}">
    <svg viewBox="0 0 ${W} ${altezza}" role="img" aria-label="Grafico della fermentazione: ${usate.map(s => s[1]).join(', ')}">
      ${svg}<line id="gf-croce" x1="0" x2="0" y1="${TOP}" y2="${fondo}" class="gf-croce" visibility="hidden"/>
      <rect x="${SX}" y="0" width="${W - SX - DX}" height="${altezza}" fill="transparent" id="gf-area"/>
    </svg>
    <div class="gf-tip" id="gf-tip" hidden></div>
  </div>`;
}

// tooltip con crocino: il giorno più vicino e i suoi valori
export function attivaGrafico(c, diffGiorni, dataIT, cotta = {}) {
  const box = document.getElementById('graf-ferm');
  if (!box) return;
  const svg = box.querySelector('svg'), croce = box.querySelector('#gf-croce'), tip = box.querySelector('#gf-tip');
  const punti = puntiFermentazione(c, diffGiorni, cotta);
  const g0 = Number(box.dataset.g0), g1 = Number(box.dataset.g1);
  const muovi = ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const g = Math.round(g0 + (px - SX) / (W - SX - DX) * (g1 - g0));
    const p = punti.reduce((m, q) => (Math.abs(q.g - g) < Math.abs(m.g - g) ? q : m), punti[0]);
    const xs = SX + (p.g - g0) / (g1 - g0) * (W - SX - DX);
    croce.setAttribute('x1', xs); croce.setAttribute('x2', xs); croce.setAttribute('visibility', 'visible');
    const righe = SERIE.filter(([k]) => pieno(p.e[k])).map(([k, t, u, d]) => `<div class="gf-${k}"><i class="gf-pallino"></i><span>${p.e.daCotta?.includes(k) ? { densita: 'OG', temp: 'T° inoculo', ph: 'pH cotta' }[k] : t}</span> <b>${fmt(p.e[k], d)}${u ? ` ${u}` : ''}</b></div>`);
    tip.innerHTML = `<div class="gf-tip-testa">Giorno ${p.g}${p.e.data ? ` · ${dataIT(p.e.data)}` : ''}</div>${righe.join('') || '<div>nessuna misura</div>'}${p.e.nota ? `<div class="gf-nota">${p.e.nota.replace(/</g, '&lt;')}</div>` : ''}`;
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
