// Cantina: temperatura in tempo reale di ogni fermentatore (FV1-FV11), con setpoint, freddo acceso/spento,
// la cotta che c'è dentro secondo il planning e gli allarmi (dati vecchi, sonda guasta, lontano dal setpoint).
// I dati arrivano dal gateway in birrificio (tools/gateway-temperature) attraverso Supabase; gli aggiornamenti
// arrivano da soli (Supabase Realtime), con una lettura di riserva ogni minuto se il collegamento cade.
// Pagina di sola consultazione: niente da modificare, uguale per tutti i profili.

import { ascoltaTabella } from './sync.js';
import { fasiCotta, gruppoCotta, lottoGruppo } from './dominio.js';
import { CELLE, FV_CANTINA, caricaAttuali, eCella, cottePerFv, durata, fmt, profiloOggi, statoFv } from './temperature.js';

let u; // { $app, html, raw, stato, dataIT, oggiISO, diffGiorni, conGiorniDh }
export function init(strumenti) { u = strumenti; }

const NOMI_FASE = { fermentazione: 'Fermentazione', dh: 'Dry hop', maturazione: 'Maturazione' };
const ETICHETTE = { ok: 'OK', allarme: 'Allarme', muto: 'Senza dati', nessuno: 'Non collegato', spento: 'Disattivato' };
const AVVISI = {
  locale: 'App in modalità solo locale: le temperature arrivano solo con il cloud configurato.',
  mancante: 'Le tabelle delle temperature non ci sono ancora: eseguire supabase/migrazione_temperature.sql nel SQL editor di Supabase.',
  offline: 'Senza internet: le temperature non si aggiornano.',
  http: 'Temperature non disponibili in questo momento.',
};

// stato della pagina, tenuto tra un ridisegno e l'altro
const dati = { sensori: new Map(), attuali: new Map(), salvato: null, errore: null, caricato: false };
let tempoReale = 'scollegato';
// unghia scelta: 'fv' (fermentatori) o 'celle', ricordata su questo dispositivo
let unghia = (() => { try { return localStorage.getItem('gb-cantina-unghia') === 'celle' ? 'celle' : 'fv'; } catch { return 'fv'; } })();
let chiudiAscolto = null, timerOre = null, timerRiserva = null;

const ordinaFv = (a, b) => a.localeCompare(b, 'it', { numeric: true });

function elencoFv() {
  const nomi = new Set([...FV_CANTINA, ...u.stato.fv.map(f => f.nome), ...dati.sensori.keys(), ...dati.attuali.keys()]);
  return [...nomi].filter(n => !eCella(n)).sort(ordinaFv);
}

// Disegno del fermentatore: tronco conico per gli isobarici, fondo piatto per gli altri (FV6-FV7).
// Pieno di birra se c'è una cotta, fascia della camicia blu quando il freddo è acceso.
function disegnoFv(conico, pieno, freddo) {
  const corpo = conico
    ? 'M10 22 Q10 8 30 6 Q50 8 50 22 L50 70 L32 90 L28 90 L10 70 Z'
    : 'M10 22 Q10 8 30 6 Q50 8 50 22 L50 84 L10 84 Z';
  const birra = conico ? 'M10 34 L50 34 L50 70 L32 90 L28 90 L10 70 Z' : 'M10 34 L50 34 L50 84 L10 84 Z';
  const gambe = conico
    ? '<path d="M13 70 V104 M47 70 V104" class="fv-gambe"/>'
    : '<path d="M14 84 V104 M46 84 V104" class="fv-gambe"/><path d="M50 78 h5 v4" class="fv-tubo"/>';
  return u.raw(`<svg class="fv-disegno${freddo ? ' freddo' : ''}" viewBox="0 0 60 108" aria-hidden="true">
    ${pieno ? `<path d="${birra}" class="fv-birra"/>` : ''}
    <rect x="10" y="38" width="40" height="18" class="fv-camicia"/>
    <path d="${corpo}" class="fv-corpo"/>
    <path d="M27 6 v-4 h6 v4" class="fv-tubo"/>
    ${gambe}
  </svg>`);
}

// Disegno di una cella frigo (porta con maniglia) o del frigo luppoli (armadio con cono di luppolo)
function disegnoCella(forma, freddo) {
  const dentro = forma === 'frigo'
    ? '<rect x="12" y="10" width="36" height="88" rx="4" class="fv-corpo"/><path d="M12 40 H48" class="fv-tubo"/><path d="M42 20 v12 M42 50 v14" class="fv-gambe"/>'
      + '<path d="M24 66 q6 -10 12 0 q-6 4 -12 0 Z M24 74 q6 -10 12 0 q-6 4 -12 0 Z M25 82 q5 -9 10 0 q-5 6 -10 0 Z" class="fv-luppolo"/>'
    : '<path d="M4 20 L30 6 L56 20 V100 H4 Z" class="fv-corpo"/><rect x="16" y="38" width="28" height="62" class="fv-corpo"/><path d="M38 66 v10" class="fv-gambe"/>';
  return u.raw(`<svg class="fv-disegno cella${freddo ? ' freddo' : ''}" viewBox="0 0 60 108" aria-hidden="true">
    ${forma === 'frigo' ? '' : '<rect x="16" y="24" width="28" height="8" class="fv-camicia"/>'}
    ${dentro}
  </svg>`);
}

function schedaCella(cella) {
  const { html } = u;
  const att = dati.attuali.get(cella.id);
  const sens = dati.sensori.get(cella.id);
  const st = statoFv(att, sens);
  const t = att && att.temperatura !== null ? Number(att.temperatura) : null;
  const sp = att && att.setpoint !== null ? Number(att.setpoint) : null;
  const lim = sens?.temp_min != null && sens?.temp_max != null ? `${fmt(sens.temp_min)} … ${fmt(sens.temp_max)} °C` : sens?.temp_max != null ? `max ${fmt(sens.temp_max)} °C` : sens?.temp_min != null ? `min ${fmt(sens.temp_min)} °C` : '';
  return html`<section class="fv-card ${st.livello}" data-fv="${cella.id}">
    <header><span class="w-fvnome">${cella.nome}</span><span class="chip fv-stato">${st.livello === 'allarme' || st.livello === 'muto' ? '⚠ ' : ''}${ETICHETTE[st.livello]}</span></header>
    <div class="fv-valori">
      ${disegnoCella(cella.forma, att?.raffreddamento === true)}
      <span class="fv-temp">${t !== null ? fmt(t) : '—'}<small> °C</small></span>
      <span class="fv-dett">
        ${sp !== null ? html`<span>Setpoint <b>${fmt(sp)} °C</b></span>` : ''}
        <span>Limiti <b>${lim || '—'}</b></span>
      </span>
    </div>
    <footer>${st.motivi.length ? html`<span class="fv-motivi">${st.motivi.join(' · ')}</span>` : ''}
      <span class="totale">${att ? `aggiornato ${st.minuti < 1 ? 'adesso' : `${durata(st.minuti)} fa`}` : sens ? 'nessuna lettura ricevuta' : 'sonda non ancora collegata'}</span></footer>
  </section>`;
}

function scheda(fv, occ, oggi) {
  const { html, dataIT, diffGiorni } = u;
  const att = dati.attuali.get(fv);
  const sens = dati.sensori.get(fv);
  const st = statoFv(att, sens);
  const t = att && att.temperatura !== null ? Number(att.temperatura) : null;
  const sp = att && att.setpoint !== null ? Number(att.setpoint) : null;
  let cotta = '';
  if (occ) {
    const c0 = occ.cotte[0];
    const g = gruppoCotta(c0, u.stato.cotte);
    const fase = fasiCotta(u.conGiorniDh(g), u.stato.durate).find(f => f.da <= oggi && f.a >= oggi)?.fase || 'fermentazione';
    const prof = profiloOggi(c0, u.stato.cotte, oggi);
    cotta = html`<a class="fv-cotta" href="#/cotta/${encodeURIComponent(c0.id)}">
      <b>${c0.birra || 'Senza nome'}</b> <span class="totale">${g.length > 1 ? lottoGruppo(g) : c0.lotto || ''}</span>
      <small><span class="w-fase" style="--f:var(--f-${fase})"></span>${NOMI_FASE[fase]} · giorno ${diffGiorni(c0.data, oggi) + 1}${occ.periodo.travaso ? ' · dopo il travaso' : ''} · fino al ${dataIT(occ.periodo.a)}${prof !== null ? ` · profilo ${fmt(prof)} °C` : ''}</small></a>`;
  } else cotta = html`<p class="fv-vuoto">Vuoto</p>`;
  return html`<section class="fv-card ${st.livello}" data-fv="${fv}">
    <header><span class="w-fvnome">${fv}</span><span class="chip fv-stato">${st.livello === 'allarme' || st.livello === 'muto' ? '⚠ ' : ''}${ETICHETTE[st.livello]}</span></header>
    <div class="fv-valori">
      ${disegnoFv(u.stato.fv.find(f => f.nome === fv)?.isobarico !== false, !!occ, att?.raffreddamento === true)}
      <span class="fv-temp">${t !== null ? fmt(t) : '—'}<small> °C</small></span>
      <span class="fv-dett">
        <span>Setpoint <b>${sp !== null ? `${fmt(sp)} °C` : '—'}</b></span>
        <span class="fv-freddo ${att?.raffreddamento ? 'acceso' : ''}">${att?.raffreddamento === true ? '❄ Freddo acceso' : att?.raffreddamento === false ? 'Freddo spento' : 'Freddo: —'}</span>
      </span>
    </div>
    ${cotta}
    <footer>${st.motivi.length ? html`<span class="fv-motivi">${st.motivi.join(' · ')}</span>` : ''}
      <span class="totale">${att ? `aggiornato ${st.minuti < 1 ? 'adesso' : `${durata(st.minuti)} fa`}` : sens ? 'nessuna lettura ricevuta' : 'sonda non ancora collegata'}</span></footer>
  </section>`;
}

function disegna() {
  const { html, $app, oggiISO } = u;
  if (!location.hash.startsWith('#/cantina')) return;
  const oggi = oggiISO();
  const occ = cottePerFv(u.stato.cotte, u.stato.durate, u.stato.fv, oggi);
  const fvs = elencoFv();
  const daControllare = ids => ids.filter(id => ['allarme', 'muto'].includes(statoFv(dati.attuali.get(id), dati.sensori.get(id)).livello)).length;
  const allarmiFv = daControllare(fvs), allarmiCelle = daControllare(CELLE.map(c => c.id));
  const allarmi = unghia === 'celle' ? allarmiCelle : allarmiFv;
  const nomeUnghia = unghia === 'celle' ? ['cella da controllare', 'celle da controllare'] : ['fermentatore da controllare', 'fermentatori da controllare'];
  const e = dati.errore;
  $app.innerHTML = html`
    <div class="barra">
      <h1 style="margin:0">Cantina</h1>
      <div class="segmenti" id="cantina-unghie" role="tablist" aria-label="Cosa vedere">
        <button type="button" role="tab" data-u="fv" class="st-libero ${unghia === 'fv' ? 'attivo' : ''}">Fermentatori${allarmiFv ? html`<b class="fv-n-allarmi">⚠ ${allarmiFv}</b>` : ''}</button>
        <button type="button" role="tab" data-u="celle" class="st-libero ${unghia === 'celle' ? 'attivo' : ''}">Celle${allarmiCelle ? html`<b class="fv-n-allarmi">⚠ ${allarmiCelle}</b>` : ''}</button>
      </div>
      <span class="spazio"></span>
      <span class="chip fv-live ${tempoReale === 'collegato' ? 'acceso' : ''}" title="${tempoReale === 'collegato' ? 'Le temperature si aggiornano da sole' : 'Aggiornamento ogni minuto'}">${tempoReale === 'collegato' ? '● in tempo reale' : '○ aggiornamento ogni minuto'}</span>
      <button class="piccolo st-libero" id="cantina-aggiorna" title="Rileggi adesso">↻ Aggiorna</button>
    </div>
    ${e && dati.caricato ? html`<p class="avviso">${AVVISI[e.codice] || AVVISI.http}${dati.salvato ? ` Ultimi valori visti il ${new Date(dati.salvato).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}</p>` : ''}
    ${!e && allarmi ? html`<p class="avviso">⚠ ${allarmi === 1 ? `1 ${nomeUnghia[0]}` : `${allarmi} ${nomeUnghia[1]}`}</p>` : ''}
    ${dati.caricato ? '' : html`<p class="totale">Carico le temperature…</p>`}
    ${unghia === 'celle' ? html`
    <div class="cantina-griglia">${CELLE.map(schedaCella)}</div>
    <p class="totale">Allarme se la temperatura esce dai limiti della cella (min/max) o se non arrivano dati da più di 10 minuti.
      I limiti si cambiano in Supabase (tabella sensori), vedi in fondo a supabase/migrazione_temperature.sql.</p>` : html`
    <div class="cantina-griglia">${fvs.map(fv => scheda(fv, occ.get(fv), oggi))}</div>
    <p class="totale">Allarme se la temperatura si scosta dal setpoint più della soglia del sensore (di solito 1,5 °C) o se non arrivano dati da più di 10 minuti.
      La curva di ogni cotta è nella sua scheda, sezione Fermentazione.</p>`}`;
  document.getElementById('cantina-aggiorna').onclick = () => aggiorna();
  document.querySelectorAll('#cantina-unghie [data-u]').forEach(b => b.onclick = () => {
    unghia = b.dataset.u;
    try { localStorage.setItem('gb-cantina-unghia', unghia); } catch { /* solo comodità */ }
    disegna();
  });
}

async function aggiorna() {
  const r = await caricaAttuali();
  Object.assign(dati, { sensori: r.sensori, attuali: r.attuali, salvato: r.salvato, errore: r.errore || null, caricato: true });
  disegna();
}

function ferma() {
  if (chiudiAscolto) chiudiAscolto();
  chiudiAscolto = null;
  clearInterval(timerOre); clearInterval(timerRiserva);
  tempoReale = 'scollegato';
}

export async function vistaCantina() {
  disegna();
  if (!chiudiAscolto) {
    aggiorna();
    chiudiAscolto = ascoltaTabella('temperature_attuali', rec => {
      dati.attuali.set(rec.fv, rec);
      dati.errore = null;
      disegna();
    }, s => { tempoReale = s; if (s === 'collegato') aggiorna(); else disegna(); });
    timerOre = setInterval(disegna, 30_000);                                       // "aggiornato x min fa" e allarmi dati vecchi
    timerRiserva = setInterval(() => { if (tempoReale !== 'collegato') aggiorna(); }, 60_000);
  } else aggiorna();
  // all'uscita dalla pagina si chiude il collegamento (il router chiama questa funzione)
  return () => { if (!location.hash.startsWith('#/cantina')) ferma(); };
}
