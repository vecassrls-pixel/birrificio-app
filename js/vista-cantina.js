// Cantina: temperatura in tempo reale di ogni fermentatore (FV1-FV11), con setpoint, freddo acceso/spento,
// la cotta che c'è dentro secondo il planning e gli allarmi (dati vecchi, sonda guasta, lontano dal setpoint).
// I dati arrivano dal gateway in birrificio (tools/gateway-temperature) attraverso Supabase; gli aggiornamenti
// arrivano da soli (Supabase Realtime), con una lettura di riserva ogni minuto se il collegamento cade.
// Pagina di sola consultazione: niente da modificare, uguale per tutti i profili.

import { ascoltaTabella } from './sync.js';
import { fasiCotta, gruppoCotta, lottoGruppo } from './dominio.js';
import { FV_CANTINA, caricaAttuali, cottePerFv, durata, fmt, profiloOggi, statoFv } from './temperature.js';

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
let chiudiAscolto = null, timerOre = null, timerRiserva = null;

const ordinaFv = (a, b) => a.localeCompare(b, 'it', { numeric: true });

function elencoFv() {
  const nomi = new Set([...FV_CANTINA, ...u.stato.fv.map(f => f.nome), ...dati.sensori.keys(), ...dati.attuali.keys()]);
  return [...nomi].sort(ordinaFv);
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
  const stati = fvs.map(fv => statoFv(dati.attuali.get(fv), dati.sensori.get(fv)).livello);
  const allarmi = stati.filter(s => s === 'allarme' || s === 'muto').length;
  const e = dati.errore;
  $app.innerHTML = html`
    <div class="barra">
      <h1 style="margin:0">Cantina</h1>
      <span class="spazio"></span>
      <span class="chip fv-live ${tempoReale === 'collegato' ? 'acceso' : ''}" title="${tempoReale === 'collegato' ? 'Le temperature si aggiornano da sole' : 'Aggiornamento ogni minuto'}">${tempoReale === 'collegato' ? '● in tempo reale' : '○ aggiornamento ogni minuto'}</span>
      <button class="piccolo st-libero" id="cantina-aggiorna" title="Rileggi adesso">↻ Aggiorna</button>
    </div>
    ${e && dati.caricato ? html`<p class="avviso">${AVVISI[e.codice] || AVVISI.http}${dati.salvato ? ` Ultimi valori visti il ${new Date(dati.salvato).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}</p>` : ''}
    ${!e && allarmi ? html`<p class="avviso">⚠ ${allarmi === 1 ? '1 fermentatore da controllare' : `${allarmi} fermentatori da controllare`}</p>` : ''}
    ${dati.caricato ? '' : html`<p class="totale">Carico le temperature…</p>`}
    <div class="cantina-griglia">${fvs.map(fv => scheda(fv, occ.get(fv), oggi))}</div>
    <p class="totale">Allarme se la temperatura si scosta dal setpoint più della soglia del sensore (di solito 1,5 °C) o se non arrivano dati da più di 10 minuti.
      La curva di ogni cotta è nella sua scheda, sezione Fermentazione.</p>`;
  document.getElementById('cantina-aggiorna').onclick = () => aggiorna();
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
