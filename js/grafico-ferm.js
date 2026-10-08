// Grafico riassuntivo della fermentazione: temperatura, °Plato e pH giorno per giorno.
// Tre pannelli piccoli uno sopra l'altro con lo stesso asse dei giorni (niente doppio asse):
// ogni misura ha la sua scala. Passando col dito o il mouse compaiono i valori di quel giorno.

const W = 760, SX = 44, DX = 12, H = 92, GAP = 22, TOP = 8;
const SERIE = [
  ['temp', 'Temperatura', '°C', 1],
  ['densita', 'Densità', '°P', 1],
  ['ph', 'pH', '', 2],
];
const pieno = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const fmt = (v, d) => Number(v).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d });

// punti per giorno (1 = giorno di cotta) dal registro di fermentazione
export function puntiFermentazione(c, diffGiorni) {
  return (c.fermentazione || [])
    .map((e, i) => ({ g: c.data && e.data ? diffGiorni(c.data, e.data) + 1 : e.giorno || i + 1, e }))
    .filter(p => p.g > 0)
    .sort((a, b) => a.g - b.g);
}

// limiti "tondi" della scala con un po' di margine
function scala(valori, passoMin) {
  let lo = Math.min(...valori), hi = Math.max(...valori);
  if (hi - lo < passoMin) { const m = (hi + lo) / 2; lo = m - passoMin / 2; hi = m + passoMin / 2; }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

export function graficoFermentazione(c, diffGiorni, oggiG) {
  const punti = puntiFermentazione(c, diffGiorni);
  const usate = SERIE.filter(([k]) => punti.filter(p => pieno(p.e[k])).length >= 1);
  if (punti.length < 2 || !usate.length) return '';
  const g0 = punti[0].g, g1 = Math.max(punti[punti.length - 1].g, g0 + 1);
  const x = g => SX + (g - g0) / (g1 - g0) * (W - SX - DX);
  const altezza = TOP + usate.length * (H + GAP);
  // tacche dei giorni: ogni 7 giorni
  const tacche = [];
  for (let g = g0; g <= g1; g++) if (g === g0 || g % 7 === 0) tacche.push(g);
  let svg = '';
  usate.forEach(([k, titolo, unita, dec], n) => {
    const y0 = TOP + n * (H + GAP) + 14;
    const pts = punti.filter(p => pieno(p.e[k])).map(p => ({ g: p.g, v: Number(p.e[k]) }));
    const [lo, hi] = scala(pts.map(p => p.v), k === 'ph' ? 0.4 : 2);
    const y = v => y0 + H - 14 - (v - lo) / (hi - lo) * (H - 14);
    svg += `<text x="0" y="${y0 - 4}" class="gf-titolo">${titolo}${unita ? ` (${unita})` : ''}</text>`;
    // griglia orizzontale al valore minimo e massimo misurati
    const vv = pts.map(p => p.v);
    for (const v of [...new Set([Math.min(...vv), Math.max(...vv)])]) {
      svg += `<line x1="${SX}" x2="${W - DX}" y1="${y(v)}" y2="${y(v)}" class="gf-griglia"/><text x="${SX - 6}" y="${y(v) + 4}" class="gf-asse" text-anchor="end">${fmt(v, dec)}</text>`;
    }
    for (const g of tacche) svg += `<line x1="${x(g)}" x2="${x(g)}" y1="${y0}" y2="${y0 + H - 14}" class="gf-griglia"/>`;
    if (oggiG >= g0 && oggiG <= g1) svg += `<line x1="${x(oggiG)}" x2="${x(oggiG)}" y1="${y0}" y2="${y0 + H - 14}" class="gf-oggi"/>`;
    // temperatura: impostata e mantenuta, quindi a gradini; °P e pH: misure collegate
    let d = '';
    pts.forEach((p, i) => {
      if (i === 0) d = `M${x(p.g)},${y(p.v)}`;
      else d += k === 'temp' ? `H${x(p.g)}V${y(p.v)}` : `L${x(p.g)},${y(p.v)}`;
    });
    svg += `<path d="${d}" class="gf-linea"/>`;
    // punti solo dove c'è una misura (per la temperatura: dove cambia)
    pts.forEach((p, i) => {
      if (k === 'temp' && i > 0 && i < pts.length - 1 && pts[i - 1].v === p.v) return;
      svg += `<circle cx="${x(p.g)}" cy="${y(p.v)}" r="4" class="gf-punto"/>`;
    });
    // etichetta diretta sull'ultimo valore
    const ult = pts[pts.length - 1];
    svg += `<text x="${Math.min(x(ult.g) + 7, W - DX)}" y="${y(ult.v) - 8}" class="gf-val" text-anchor="${x(ult.g) > W - 60 ? 'end' : 'start'}">${fmt(ult.v, dec)}${unita === '°C' ? '°' : ''}</text>`;
  });
  const yAsse = altezza - GAP + 14;
  for (const g of tacche) svg += `<text x="${x(g)}" y="${yAsse}" class="gf-asse" text-anchor="middle">g${g}</text>`;
  return `<div class="graf-ferm" id="graf-ferm" data-g0="${g0}" data-g1="${g1}">
    <svg viewBox="0 0 ${W} ${altezza}" role="img" aria-label="Grafico della fermentazione: ${usate.map(s => s[1]).join(', ')}">
      ${svg}<line id="gf-croce" x1="0" x2="0" y1="${TOP}" y2="${altezza - GAP}" class="gf-croce" visibility="hidden"/>
      <rect x="${SX}" y="0" width="${W - SX - DX}" height="${altezza}" fill="transparent" id="gf-area"/>
    </svg>
    <div class="gf-tip" id="gf-tip" hidden></div>
  </div>`;
}

// tooltip con crocino: il giorno più vicino e i suoi valori
export function attivaGrafico(c, diffGiorni, dataIT) {
  const box = document.getElementById('graf-ferm');
  if (!box) return;
  const svg = box.querySelector('svg'), croce = box.querySelector('#gf-croce'), tip = box.querySelector('#gf-tip');
  const punti = puntiFermentazione(c, diffGiorni);
  const g0 = Number(box.dataset.g0), g1 = Number(box.dataset.g1);
  const muovi = ev => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const g = Math.round(g0 + (px - SX) / (W - SX - DX) * (g1 - g0));
    const p = punti.reduce((m, q) => (Math.abs(q.g - g) < Math.abs(m.g - g) ? q : m), punti[0]);
    const xs = SX + (p.g - g0) / (g1 - g0) * (W - SX - DX);
    croce.setAttribute('x1', xs); croce.setAttribute('x2', xs); croce.setAttribute('visibility', 'visible');
    const righe = SERIE.filter(([k]) => pieno(p.e[k])).map(([k, t, u, d]) => `<div><span>${t}</span> <b>${fmt(p.e[k], d)}${u ? ` ${u}` : ''}</b></div>`);
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
