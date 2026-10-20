// Pagina HACCP: registri e controlli del piano di autocontrollo.
// Registro S6 (in vista-magazzino.js), rintracciabilità per lotto, controllo materie prime in arrivo, scadenzario,
// registro temperature celle (dalle sonde, vedi js/temperature.js).
// Calcoli in haccp.js.

import { ID_IMPOSTAZIONI, nomeFormato } from './birra.js';
import { ID_OPERATORI, operatoriDa, opzioniOperatori, CONTROLLI_ARRIVO, FASI_PULIZIA, LINEE, fvDaPulire, inizioRegistroPulizie, statoFermentatori, conPulizieAutomatiche, PRODOTTI_PULIZIE, FASI_DEFAULT_PULIZIA, SCADENZE_CONSIGLIATE, GIORNI_PREAVVISO, controlloFatto, lottiBirra, rintracciabilita, statoScadenzaHaccp } from './haccp.js';
import { LOGO_KASHMIR } from './logo-kashmir.js';
import { interroga } from './sync.js';
import { CELLE, fmt } from './temperature.js';
import { vuotiDelleCotte } from './contenitori.js';
import { ID_TREBBIE, destinatarioDa, idTrebbia, registroTrebbie, totaliTrebbie } from './trebbie.js';
import { creaXlsx } from './xlsx.js';
import { VOCI_INFESTANTI, INIZIO_SCHEDE, annataHaccp, mesiAnnata, meseCorto, meseLungo, giorniDelMese, schedaInfestanti, pulizieAmbientiMese, sigla, GIORNI_PULIZIA_AMBIENTI } from './haccp.js';

let u; // { $app, html, raw, db, toast, chiedi, stato, dataIT, numIT, oggiISO, addGiorni }
export function init(strumenti) { u = strumenti; }

const fmtQta = (q, unita) => `${u.numIT(q, unita === 'kg' || unita === 'L' ? 2 : 0)} ${unita || ''}`.trim();
const stampa = titolo => {
  const prima = document.title;
  document.title = titolo;
  addEventListener('afterprint', () => { document.title = prima; }, { once: true });
  window.print();
};
const testa = (titolo, sotto) => u.html`<div class="s6-testa"><img src="${LOGO_KASHMIR}" alt="Kashmir Brewing Company">
  <div><h1>${titolo} /// VECAS SRLS</h1><div>${sotto} · stampato il ${u.dataIT(u.oggiISO())}</div></div></div>`;

export async function vistaHaccp() {
  const { html } = u;
  const [bolle, scadenze, pulizieReg] = await Promise.all([u.db.tutti('bolla'), u.db.tutti('scadenzahaccp'), u.db.tutti('pulizia')]);
  const pulizie = conPulizieAutomatiche(u.stato.cotte, u.stato.durate, u.stato.fv, pulizieReg, '', u.oggiISO());
  const sporchi = fvDaPulire(statoFermentatori(u.stato.cotte, u.stato.durate, u.stato.fv, pulizie, u.oggiISO()), pulizie, u.oggiISO()).length;
  const da30 = u.addGiorni(u.oggiISO(), -30);
  const daControllare = bolle.filter(b => !b.eliminato && b.data >= da30 && !controlloFatto(b)).length;
  const stati = scadenze.filter(s => !s.eliminato).map(s => statoScadenzaHaccp(s, u.oggiISO()).stato);
  const scadute = stati.filter(s => s === 'scaduta').length, vicine = stati.filter(s => s === 'vicina').length;
  const voce = (href, ico, titolo, testo, badge = '') => html`<a class="widget haccp-voce" href="${href}">
    <span class="haccp-ico" aria-hidden="true">${ico}</span>
    <span><b>${titolo}</b><small>${testo}</small>${badge}</span>
    <span class="haccp-vai" aria-hidden="true">→</span></a>`;
  u.$app.innerHTML = html`
    <div class="barra"><div><h1 style="margin:0">HACCP</h1>
      <p class="totale" style="margin:2px 0 0">Registri e controlli del piano di autocontrollo.</p></div></div>
    <div class="haccp-griglia">
      ${voce('#/registro-s6', '📒', 'Registro S6', 'Carico e scarico delle materie prime con lotti e scadenze, per settimana. Da stampare.')}
      ${voce('#/rintracciabilita', '🔎', 'Rintracciabilità per lotto', 'Da un lotto di birra: materie prime usate con lotto e fornitore, confezionamento con i lotti di lattine e fusti, e a chi è andata.')}
      ${voce('#/controllo-arrivi', '📦', 'Controllo merci in arrivo', 'Spunte di controllo su ogni bolla di carico e registro da stampare.',
        daControllare ? html`<span class="haccp-badge">${daControllare} ${daControllare === 1 ? 'bolla' : 'bolle'} da controllare</span>` : '')}
      ${voce('#/pulizie', '🧽', 'Pulizie e sanificazioni', 'CIP di fermentatori e linee: data, fasi, prodotti e chi l\'ha fatta. Avviso se un FV si riempie senza pulizia.',
        sporchi ? html`<span class="haccp-badge urgente">${sporchi} FV da pulire</span>` : '')}
      ${voce('#/temperature-celle', '🌡️', 'Temperature celle frigo', 'Registro giornaliero automatico di Cella 1, Cella 2 e frigo luppoli dalle sonde: minima, massima, media ed esito. Da stampare.')}
      ${voce('#/trebbie', '🌾', 'Registro trebbie', 'Sottoprodotto di ogni cotta: data, numero cotta, kg (dai malti della scheda) e destinazione. Da stampare o scaricare in Excel.')}
      ${voce('#/infestanti', '🐭', 'Monitoraggio insetti e roditori', 'Scheda mensile: si compila da sola con tutto "Assenza" e l\'operatore; segna "Presenza" se trovi qualcosa. Da stampare.')}
      ${voce('#/pulizie-ambienti', '🧹', 'Esecuzione pulizie', 'Griglia giorni × mesi (marzo-febbraio): "sì" e firma circa due volte al mese, da sola; tocca un giorno per aggiungere o togliere.')}
      ${voce('#/scadenzario', '🗓️', 'Scadenzario HACCP', 'Analisi dell\'acqua, tarature, manutenzioni, disinfestazione e formazione, con avviso in Home.',
        scadute || vicine ? html`<span class="haccp-badge ${scadute ? 'urgente' : ''}">${[scadute && `${scadute} ${scadute === 1 ? 'scaduta' : 'scadute'}`, vicine && `${vicine} in scadenza`].filter(Boolean).join(' · ')}</span>` : '')}
    </div>`;
}

// ---------- rintracciabilità ----------
export async function vistaRintracciabilita(id) {
  const { html } = u;
  const lotti = lottiBirra(u.stato.cotte, u.oggiISO());
  const scelto = id ? lotti.find(l => l.gruppo.some(c => c.id === id)) : null;
  if (!scelto) {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Rintracciabilità</h1></div>
      <div class="scheda">
        <label>Cerca il lotto o la birra<input id="rt-cerca" type="search" placeholder="es. 53/26 oppure Strogoff" autofocus></label>
        <ul class="rt-lotti">${lotti.map(l => html`<li data-testo="${`${l.lotto} ${l.birra}`.toLowerCase()}"><a href="#/rintracciabilita/${encodeURIComponent(l.id)}">
          <b>${l.lotto || 'senza lotto'}</b> <span>${l.birra}</span> <small>${u.dataIT(l.data)}${l.fv ? ` · ${l.fv}` : ''}</small></a></li>`)}</ul>
        ${lotti.length ? '' : html`<p class="vuoto">Nessuna cotta fatta.</p>`}
      </div>`;
    const cerca = document.getElementById('rt-cerca');
    cerca.oninput = () => {
      const q = cerca.value.trim().toLowerCase();
      u.$app.querySelectorAll('.rt-lotti li').forEach(li => { li.hidden = !!q && !li.dataset.testo.includes(q); });
    };
    return;
  }
  const [articoli, bolle, inventari, scarichi, movimenti, inventariBirra, prodotti, contenitori, movVuoti, invVuoti, imp] = await Promise.all([
    ...['articolo', 'bolla', 'inventario', 'scarico', 'movbirra', 'inventariobirra', 'prodottobirra', 'contenitore', 'movcontenitore', 'inventariocontenitori'].map(t => u.db.tutti(t)),
    u.db.leggi(ID_IMPOSTAZIONI),
  ]);
  const vuoti = vuotiDelleCotte(scelto.gruppo.map(c => c.id), { contenitori, movimenti: movVuoti, inventari: invVuoti, cotte: u.stato.cotte }, u.oggiISO()).filter(x => x.contato);
  const r = rintracciabilita(scelto,
    { articoli, bolle, inventari, scarichi, cotte: u.stato.cotte },
    { cotte: u.stato.cotte, durate: u.stato.durate, movimenti, inventari: inventariBirra, prodotti, impostazioni: imp && !imp.eliminato ? imp : null });
  const senzaLotto = r.materie.filter(m => !m.lotto).length;
  const c0 = scelto.gruppo[0];
  const doppia = scelto.gruppo.length > 1;
  const numeroDi = new Map(scelto.gruppo.map(c => [c.id, c.numero]));
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/rintracciabilita" class="btn">← Lotti</a><span class="spazio"></span>
      <a class="btn" href="#/cotta/${encodeURIComponent(c0.id)}">Scheda cotta</a>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    <div class="s6 rt-foglio">
      ${testa(`RINTRACCIABILITÀ LOTTO ${scelto.lotto || '—'}`, `${scelto.birra} · ${scelto.gruppo.length > 1 ? 'cotte' : 'cotta'} ${scelto.gruppo.map(c => `${c.numero ?? ''} del ${u.dataIT(c.data)}`).join(', ')}${c0.fv ? ` · ${c0.fv}` : ''}`)}
      <h2>1. Materie prime usate</h2>
      ${senzaLotto ? html`<p class="totale non-stampa">⚠ ${senzaLotto} ${senzaLotto === 1 ? 'materia prima non ha' : 'materie prime non hanno'} il lotto: scrivilo nella scheda cotta o nel registro S6.</p>` : ''}
      ${r.materie.length ? html`<table class="tab-s6">
        <thead><tr><th>Data</th>${doppia ? html`<th>Cotta</th>` : ''}<th>Materia prima</th><th>Lotto</th><th class="n">Quantità</th><th>Scadenza</th><th>Fornitore / DDT</th><th>Arrivata il</th></tr></thead>
        <tbody>${r.materie.map(m => html`<tr><td>${u.dataIT(m.data)}</td>${doppia ? html`<td>${numeroDi.get(m.dove.id) ?? ''}</td>` : ''}<td>${m.prodotto}</td><td>${m.lotto || html`<span class="rt-manca">manca</span>`}</td>
          <td class="n">${fmtQta(m.qta, m.unita)}</td><td>${m.scadenzaLotto ? u.dataIT(m.scadenzaLotto) : ''}</td><td>${m.fornitore}</td><td>${m.arrivo ? u.dataIT(m.arrivo) : ''}</td></tr>`)}</tbody></table>`
      : html`<p class="vuoto">Nessuna materia prima nella scheda cotta.</p>`}
      <h2>2. Confezionamento</h2>
      ${r.confezionato.length ? html`<table class="tab-s6">
        <thead><tr><th>Data</th><th>Formato</th><th class="n">Pezzi</th><th class="n">Litri</th></tr></thead>
        <tbody>${r.confezionato.map(x => html`<tr><td>${x.data ? u.dataIT(x.data) : ''}</td><td>${nomeFormato(x.tipo, x.litri)}</td><td class="n">${u.numIT(x.pezzi, 0)}</td><td class="n">${u.numIT(x.pezzi * x.litri, 1)}</td></tr>`)}</tbody></table>`
      : html`<p class="vuoto">Non ancora confezionata.</p>`}
      <h2>3. Lattine e fusti usati (lotti dei vuoti)</h2>
      ${vuoti.length ? html`<table class="tab-s6">
        <thead><tr><th>Data</th><th>Contenitore</th><th class="n">Pezzi</th><th>Lotto</th><th>Fornitore / documento</th><th>Arrivato il</th></tr></thead>
        <tbody>${vuoti.flatMap(v => v.lotti.map(l => html`<tr><td>${u.dataIT(v.data)}</td><td>${v.contenitore.nome}</td><td class="n">${u.numIT(l.pezzi, 0)}</td>
          <td>${l.lotto || html`<span class="rt-manca">manca</span>`}</td><td>${[l.fornitore, l.documento].filter(Boolean).join(' · ')}</td><td>${l.arrivo ? u.dataIT(l.arrivo) : ''}</td></tr>`))}</tbody></table>`
      : html`<p class="vuoto">${contenitori.length ? 'Nessun contenitore scalato da questo confezionamento (pagina Contenitori).' : 'I lotti di lattine e fusti si vedono qui quando usi la pagina Contenitori.'}</p>`}
      <h2>4. Uscite della birra (destinatari)</h2>
      ${r.uscite.length ? html`<table class="tab-s6">
        <thead><tr><th>Data</th><th>Prodotto</th><th class="n">Pezzi</th><th class="n">Litri</th><th>Destinatario / documento</th></tr></thead>
        <tbody>${r.uscite.map(x => html`<tr><td>${u.dataIT(x.data)}</td><td>${x.prodotto}</td><td class="n">${u.numIT(x.pezzi, 0)}</td><td class="n">${u.numIT(x.litri, 1)}</td><td>${x.chi}</td></tr>`)}</tbody></table>`
      : html`<p class="vuoto">Nessuna uscita registrata per questo lotto nel magazzino birra.</p>`}
    </div>`;
  document.getElementById('stampa').onclick = () => stampa(`Rintracciabilita lotto ${scelto.lotto} ${scelto.birra}`);
}

// ---------- controllo materie prime in arrivo ----------
const reg = { da: '', a: '' };
export async function vistaControlloArrivi() {
  const { html } = u;
  const oggi = u.oggiISO();
  if (!reg.da) { reg.da = `${oggi.slice(0, 7)}-01`; reg.a = oggi; }
  const bolle = (await u.db.tutti('bolla')).filter(b => !b.eliminato && b.data && b.data >= reg.da && b.data <= reg.a)
    .sort((x, y) => x.data.localeCompare(y.data));
  const mancano = bolle.filter(b => !controlloFatto(b)).length;
  const si = v => (v ? '✓' : v === false ? '✗' : '');
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/haccp" class="btn">← HACCP</a>
      <label>Dal <input type="date" id="ca-da" value="${reg.da}"></label>
      <label>Al <input type="date" id="ca-a" value="${reg.a}"></label>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    ${mancano ? html`<p class="totale non-stampa">⚠ ${mancano} ${mancano === 1 ? 'bolla senza controllo' : 'bolle senza controllo'}: aprila e compila "Controllo all'arrivo". In stampa restano le caselle vuote da compilare a mano.</p>` : ''}
    <div class="s6">
      ${testa('CONTROLLO MERCI IN ARRIVO', `Periodo: dal ${u.dataIT(reg.da)} al ${u.dataIT(reg.a)}`)}
      ${bolle.length ? html`<table class="tab-s6 tab-arrivi">
        <thead><tr><th>Data</th><th>Fornitore / DDT</th><th>Merce e lotti</th>${CONTROLLI_ARRIVO.map(([, n]) => html`<th class="c">${n}</th>`)}<th>Esito</th><th>Controllato da</th><th>Note</th></tr></thead>
        <tbody>${bolle.map(b => {
          const ck = b.controllo || {};
          return html`<tr>
            <td>${u.dataIT(b.data)}</td>
            <td><a href="#/bolla/${encodeURIComponent(b.id)}">${[b.fornitore, b.numero && `DDT ${b.numero}`].filter(Boolean).join(' · ') || 'bolla'}</a></td>
            <td>${(b.righe || []).map(r => `${r.nome}${r.lotto ? ` (${r.lotto})` : ''}`).join(', ')}</td>
            ${CONTROLLI_ARRIVO.map(([c]) => html`<td class="c">${controlloFatto(b) ? si(ck[c]) : ''}</td>`)}
            <td>${ck.esito ? html`<span class="${ck.esito === 'conforme' ? '' : 'rt-manca'}">${ck.esito}</span>` : html`<span class="non-stampa rt-manca">da controllare</span>`}</td>
            <td>${ck.chi || ''}</td><td>${ck.note || ''}</td></tr>`;
        })}</tbody></table>`
      : html`<p class="vuoto">Nessuna bolla nel periodo.</p>`}
    </div>`;
  document.getElementById('ca-da').onchange = e => { reg.da = e.target.value; vistaControlloArrivi(); };
  document.getElementById('ca-a').onchange = e => { reg.a = e.target.value; vistaControlloArrivi(); };
  document.getElementById('stampa').onclick = () => stampa(`Controllo merci in arrivo ${reg.da} ${reg.a}`);
}

// ---------- scadenzario ----------
const salvaScad = ({ aggiornato: _a, ...s }) => u.db.salva(s);
export async function vistaScadenzario() {
  const { html } = u;
  const oggi = u.oggiISO();
  const lista = (await u.db.tutti('scadenzahaccp')).filter(s => !s.eliminato).map(s => ({ s, ...statoScadenzaHaccp(s, oggi) }))
    .sort((a, b) => (a.stato === 'manca') - (b.stato === 'manca') || (a.giorni ?? 0) - (b.giorni ?? 0) || a.s.nome.localeCompare(b.s.nome, 'it'));
  const testoStato = x => (x.stato === 'manca' ? 'scrivi l\'ultima volta'
    : x.stato === 'scaduta' ? `scaduta da ${-x.giorni} gg` : x.giorni === 0 ? 'scade oggi' : `tra ${x.giorni} gg`);
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Scadenzario HACCP</h1><span class="spazio"></span>
      <button class="primario solo-editori" id="sc-nuova">+ Scadenza</button>
    </div>
    ${lista.length ? '' : html`<div class="scheda avviso solo-editori"><h2>Per iniziare</h2>
      <p>Aggiungo le scadenze tipiche di un birrificio? Poi cambi la frequenza e scrivi quando le hai fatte l'ultima volta.</p>
      <p class="totale">${SCADENZE_CONSIGLIATE.map(([n, m]) => `${n} (ogni ${m} ${m === 1 ? 'mese' : 'mesi'})`).join(' · ')}</p>
      <button class="primario" id="sc-consigliate">Aggiungi le scadenze tipiche</button></div>`}
    ${lista.length ? html`<div class="scheda"><div class="scroll-x"><table class="tab-edit tab-scad">
      <thead><tr><th>Cosa</th><th class="n">Ogni (mesi)</th><th>Ultima volta</th><th>Prossima</th><th></th><th></th><th></th></tr></thead>
      <tbody>${lista.map(x => html`<tr class="sc-${x.stato}">
        <td><input data-s="${x.s.id}|nome" value="${x.s.nome}"></td>
        <td><input data-s="${x.s.id}|ogniMesi" type="number" min="1" step="1" inputmode="numeric" value="${x.s.ogniMesi ?? ''}"></td>
        <td><input data-s="${x.s.id}|ultima" type="date" value="${x.s.ultima || ''}"></td>
        <td>${x.prossima ? u.dataIT(x.prossima) : '—'} <span class="sc-stato">${testoStato(x)}</span></td>
        <td><button class="piccolo solo-editori" data-fatto="${x.s.id}" title="Segna fatta oggi: la prossima si sposta in avanti">✓ Fatta oggi</button></td>
        <td><input data-s="${x.s.id}|note" value="${x.s.note || ''}" placeholder="note (ditta, referente…)"></td>
        <td class="az"><button class="piccolo solo-editori" data-del="${x.s.id}" title="Elimina">✕</button></td></tr>`)}</tbody>
    </table></div>
    <p class="totale">In Home compaiono le scadenze già passate e quelle dei prossimi ${GIORNI_PREAVVISO} giorni.</p></div>` : ''}`;

  const per = id => lista.find(x => x.s.id === id)?.s;
  u.$app.onchange = async e => {
    const t = e.target;
    if (!t.dataset.s) return;
    const [id, campo] = t.dataset.s.split('|');
    const s = per(id);
    let v = t.value;
    if (campo === 'ogniMesi') v = Math.max(1, Math.round(Number(v) || 0)) || null;
    if (campo === 'nome' && !v.trim()) return vistaScadenzario();
    await salvaScad({ ...s, [campo]: typeof v === 'string' ? v.trim() : v });
    if (campo !== 'note') vistaScadenzario();
  };
  u.$app.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'sc-consigliate') {
      await u.db.salvaMolti(SCADENZE_CONSIGLIATE.map(([nome, ogniMesi]) => ({ id: u.db.nuovoId('scadenzahaccp'), tipo: 'scadenzahaccp', nome, ogniMesi, ultima: '', note: '', storico: [] })));
      return vistaScadenzario();
    }
    if (b.id === 'sc-nuova') {
      await salvaScad({ id: u.db.nuovoId('scadenzahaccp'), tipo: 'scadenzahaccp', nome: 'Nuova scadenza', ogniMesi: 12, ultima: '', note: '', storico: [] });
      await vistaScadenzario();
      const ultimi = u.$app.querySelectorAll('[data-s$="|nome"]');
      [...ultimi].find(i => i.value === 'Nuova scadenza')?.select();
      return;
    }
    if (b.dataset.fatto) {
      const s = per(b.dataset.fatto);
      await salvaScad({ ...s, ultima: oggi, storico: [...(s.storico || []), { data: oggi }] });
      u.toast(`${s.nome}: fatta oggi`);
      return vistaScadenzario();
    }
    if (b.dataset.del) {
      const s = per(b.dataset.del);
      if (!(await u.chiedi(`Eliminare "${s.nome}" dallo scadenzario?`, 'Elimina'))) return;
      await u.db.elimina(s.id);
      return vistaScadenzario();
    }
  };
}

// ---------- pulizie e sanificazioni (CIP) ----------
// con cosa si pulisce: di default soda 3% e sanificante 2%, fasi tutte tranne l'acido (Romain, 2026-10-15);
// chi la fa: il primo degli operatori in Impostazioni. Tutto si cambia nel modulo.
const regP = { da: '', a: '' };
export async function vistaPulizie(cosaScelta = '') {
  const { html } = u;
  const oggi = u.oggiISO();
  if (!regP.da) { regP.da = `${oggi.slice(0, 7)}-01`; regP.a = oggi; }
  const pulizieReg = await u.db.tutti('pulizia');
  const operatori = operatoriDa(await u.db.leggi(ID_OPERATORI));
  // registrate + automatiche (una per ogni FV svuotato senza pulizia registrata), vedi conPulizieAutomatiche
  const pulizie = conPulizieAutomatiche(u.stato.cotte, u.stato.durate, u.stato.fv, pulizieReg, operatori[0], oggi);
  const stati = statoFermentatori(u.stato.cotte, u.stato.durate, u.stato.fv, pulizie, oggi);
  const daPulire = new Set(fvDaPulire(stati, pulizie, oggi).map(s => s.fv.nome));
  const inizio = inizioRegistroPulizie(pulizie);
  const nel = pulizie.filter(p => p.data >= regP.da && p.data <= regP.a).sort((a, b) => a.data.localeCompare(b.data) || a.cosa.localeCompare(b.cosa, 'it', { numeric: true }));
  const prodottiUsati = [...new Set(pulizieReg.map(p => p.prodotti).filter(Boolean))];
  const lineeUsate = [...new Set([...LINEE, ...pulizie.map(p => p.cosa)])].filter(x => !u.stato.fv.some(f => f.nome === x));
  const nuova = { data: oggi, cosa: cosaScelta, fasi: FASI_DEFAULT_PULIZIA, prodotti: PRODOTTI_PULIZIE, chi: operatori[0], note: '' };
  const birraDi = r => r.cotte.map(c => c.birra).filter((x, i, a) => a.indexOf(x) === i).join(' + ');
  u.$app.innerHTML = html`
    <div class="barra non-stampa"><a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Pulizie e sanificazioni</h1></div>
    <div class="scheda non-stampa">
      <h2>Fermentatori</h2>
      ${pulizie.length ? '' : html`<p class="totale">Registra la prima pulizia: da quel giorno l'app avvisa quando un FV svuotato non risulta pulito prima del riempimento.</p>`}
      <div class="scroll-x"><table class="tab-mag tab-fv-pulizia">
        <thead><tr><th>FV</th><th>Oggi</th><th>Ultima pulizia</th><th>Prossimo riempimento</th><th></th></tr></thead>
        <tbody>${stati.map(s => html`<tr class="${daPulire.has(s.fv.nome) ? 'fv-sporco' : ''}">
          <td><b>${s.fv.nome}</b></td>
          <td>${s.ora ? html`pieno · ${birraDi(s.ora)}${s.ora.pulito || !inizio || s.ora.da < inizio ? '' : html` <span class="rt-manca" title="Nessuna pulizia registrata tra lo svuotamento precedente e il riempimento">· senza pulizia</span>`}`
            : s.svuotato ? html`vuoto dal ${u.dataIT(s.svuotato)} · ${s.pulitoOra ? html`<span class="fv-ok">✓ pulito</span>` : daPulire.has(s.fv.nome) ? html`<span class="rt-manca">da pulire</span>` : html`<span class="totale">pulizia non registrata</span>`}` : 'vuoto'}</td>
          <td>${s.ultima ? `${u.dataIT(s.ultima.data)}${s.ultima.chi ? ` · ${s.ultima.chi}` : ''}` : '—'}</td>
          <td>${s.prossimo ? `${u.dataIT(s.prossimo.da)} · ${birraDi(s.prossimo)}` : '—'}</td>
          <td><button class="piccolo solo-editori" data-pulisci="${s.fv.nome}">Registra pulizia</button></td></tr>`)}</tbody>
      </table></div>
    </div>
    <div class="scheda non-stampa solo-editori" id="pl-form">
      <h2>Registra una pulizia</h2>
      <div class="griglia">
        <label>Data<input type="date" id="pl-data" value="${nuova.data}"></label>
        <label>Cosa (FV o linea)<input id="pl-cosa" list="pl-cose" value="${nuova.cosa}" placeholder="es. FV3 o Linea fusti"></label>
        <label style="grid-column:span 2">Prodotti e concentrazione<input id="pl-prodotti" list="pl-prod" value="${nuova.prodotti}" placeholder="es. soda 2% a 70 °C, PAA 0,2%"></label>
        <label>Fatta da<select id="pl-chi">${operatori.map(n => html`<option ${n === nuova.chi ? 'selected' : ''}>${n}</option>`)}</select></label>
      </div>
      <datalist id="pl-cose">${u.stato.fv.map(f => html`<option value="${f.nome}">`)}${lineeUsate.map(x => html`<option value="${x}">`)}</datalist>
      <datalist id="pl-prod">${prodottiUsati.map(x => html`<option value="${x}">`)}</datalist>
      <div class="ck-spunte" style="margin-top:10px">${FASI_PULIZIA.map(f => html`<label><input type="checkbox" data-fase="${f}" ${nuova.fasi.includes(f) ? 'checked' : ''}> ${f}</label>`)}</div>
      <label style="margin-top:10px">Note<input id="pl-note" placeholder="es. controllo visivo ok, guarnizioni cambiate"></label>
      <div class="barra"><span class="spazio"></span><button class="primario" id="pl-salva">Registra</button></div>
    </div>
    <div class="barra non-stampa">
      <label>Dal <input type="date" id="pl-da" value="${regP.da}"></label>
      <label>Al <input type="date" id="pl-a" value="${regP.a}"></label>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    <p class="totale non-stampa">Si compila da solo: quando un FV si svuota (fine in FV o travaso) e nei giorni di confezionamento in lattina (inlattinatrice) c'è la pulizia di quel giorno con ${FASI_DEFAULT_PULIZIA.join(', ').toLowerCase()}, ${PRODOTTI_PULIZIE.toLowerCase()} e ${operatori[0]} (primo operatore in <a href="#/impostazioni">Impostazioni</a>).
      Ogni riga si corregge scrivendo qui sotto; ✕ su una riga automatica vuol dire che quella pulizia non è stata fatta.</p>
    <div class="s6">
      ${testa('REGISTRO PULIZIE E SANIFICAZIONI', `Periodo: dal ${u.dataIT(regP.da)} al ${u.dataIT(regP.a)}`)}
      ${nel.length ? html`<table class="tab-s6 tab-pulizie">
        <thead><tr><th>Data</th><th>FV / linea</th><th>Fasi</th><th>Prodotti e concentrazione</th><th>Fatta da</th><th>Note</th><th class="non-stampa"></th></tr></thead>
        <tbody>${nel.map(p => html`<tr><td>${u.dataIT(p.data)}</td><td>${p.cosa}</td><td>${(p.fasi || []).join(', ')}</td>
          <td><input class="s6-lotto" data-pl="${p.id}|prodotti" list="pl-prod" value="${p.prodotti || ''}"></td>
          <td><select class="s6-lotto" data-pl="${p.id}|chi">${opzioniOperatori(operatori, p.chi).map(n => html`<option ${n === p.chi ? 'selected' : ''}>${n}</option>`)}</select></td>
          <td><input class="s6-lotto" data-pl="${p.id}|note" value="${p.note || ''}"></td>
          <td class="non-stampa az"><button class="piccolo solo-editori" data-del="${p.id}" title="${p.auto ? 'Non è stata fatta: togli la riga' : 'Elimina'}">✕</button></td></tr>`)}</tbody></table>`
      : html`<p class="vuoto">Nessuna pulizia nel periodo.</p>`}
    </div>`;
  const $ = id => document.getElementById(id);
  $('pl-da').onchange = e => { regP.da = e.target.value; vistaPulizie(); };
  $('pl-a').onchange = e => { regP.a = e.target.value; vistaPulizie(); };
  $('stampa').onclick = () => stampa(`Registro pulizie ${regP.da} ${regP.a}`);
  // correzione di una riga: quella automatica diventa un record salvato con lo stesso id
  const salvaPulizia = async (p, campi) => {
    const { aggiornato: _a, birra: _b, ...rec } = p;
    await u.db.salva({ ...rec, ...campi, ...(p.auto ? { auto: true, corretta: true } : {}) });
  };
  u.$app.onchange = async e => {
    const t = e.target;
    if (!t.dataset.pl) return;
    const [id, campo] = t.dataset.pl.split('|');
    const p = pulizie.find(x => x.id === id);
    if (!p) return;
    await salvaPulizia(p, { [campo]: t.value.trim() });
    u.toast('Pulizia aggiornata');
    vistaPulizie();
  };
  u.$app.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pulisci) {
      $('pl-cosa').value = b.dataset.pulisci;
      $('pl-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return $('pl-prodotti').focus({ preventScroll: true });
    }
    if (b.id === 'pl-salva') {
      const rec = {
        id: u.db.nuovoId('pulizia'), tipo: 'pulizia', data: $('pl-data').value, cosa: $('pl-cosa').value.trim(),
        fasi: FASI_PULIZIA.filter(f => u.$app.querySelector(`[data-fase="${f}"]`).checked),
        prodotti: $('pl-prodotti').value.trim(), chi: $('pl-chi').value.trim(), note: $('pl-note').value.trim(),
      };
      if (!rec.data || !rec.cosa) return u.toast('Servono la data e cosa hai pulito');
      await u.db.salva(rec);
      u.toast(`Pulizia ${rec.cosa} registrata`);
      if (rec.data < regP.da || rec.data > regP.a) { regP.da = `${rec.data.slice(0, 7)}-01`; regP.a = rec.data > oggi ? rec.data : oggi; }
      return vistaPulizie();
    }
    if (b.dataset.del) {
      const p = pulizie.find(x => x.id === b.dataset.del);
      if (p.auto) {
        // la riga automatica non si cancella (tornerebbe): si segna come non fatta, così il FV risulta da pulire
        if (!(await u.chiedi(`La pulizia di ${p.cosa} del ${u.dataIT(p.data)} non è stata fatta? La tolgo dal registro e ${p.cosa} risulta da pulire.`, 'Non fatta'))) return;
        await salvaPulizia(p, { nonFatta: true });
        return vistaPulizie();
      }
      if (!(await u.chiedi(`Eliminare la pulizia di ${p.cosa} del ${u.dataIT(p.data)}?`, 'Elimina'))) return;
      await u.db.elimina(p.id);
      return vistaPulizie();
    }
  };
}

// ---------- registro temperature celle (automatico dalle sonde) ----------
// Una riga per giorno: minima, massima e media di ogni cella e del frigo luppoli (dallo storico ogni 5 minuti
// del gateway, js/temperature.js), esito rispetto ai limiti della sonda e nota/azione correttiva del giorno.
const regT = { mese: '' };
const TOLLERANZA_MIN = 30; // fino a 30 minuti fuori limite nel giorno (porta aperta, carico merce) il giorno resta conforme

export async function vistaTemperatureCelle() {
  const { html } = u;
  const oggi = u.oggiISO();
  if (!regT.mese) regT.mese = oggi.slice(0, 7);
  const da = `${regT.mese}-01`;
  const fineMese = u.addGiorni(`${u.addGiorni(da, 32).slice(0, 7)}-01`, -1);
  const a = fineMese < oggi ? fineMese : oggi;
  let righe = [], sensori = [], errore = null;
  if (da <= oggi) {
    try {
      [righe, sensori] = await Promise.all([
        interroga('rpc/temperature_giornaliere', { method: 'POST', body: { p_fv: CELLE.map(c => c.id), p_da: da, p_a: a } }),
        interroga(`sensori?select=fv,temp_min,temp_max&fv=in.(${CELLE.map(c => `"${c.id}"`).join(',')})`),
      ]);
    } catch (e) { errore = e; }
  }
  const note = new Map((await u.db.tutti('notatempcelle')).filter(n => !n.eliminato && n.data >= da && n.data <= a).map(n => [n.data, n]));
  const limiti = new Map(sensori.map(s => [s.fv, s]));
  const per = new Map(righe.map(r => [`${r.giorno}|${r.fv}`, r]));
  const giorni = [];
  for (let g = da; g <= a; g = u.addGiorni(g, 1)) giorni.push(g);
  const t = v => (v === null || v === undefined ? '' : fmt(v));
  const fuori = r => r && r.minuti_fuori > TOLLERANZA_MIN;
  const esito = g => {
    const rr = CELLE.map(c => per.get(`${g}|${c.id}`)).filter(Boolean);
    if (!rr.length) return '';
    return rr.some(fuori) ? 'Non conforme' : 'Conforme';
  };
  const nonConformi = giorni.filter(g => esito(g) === 'Non conforme').length;
  const limTesto = c => {
    const l = limiti.get(c.id) || {};
    return l.temp_min != null && l.temp_max != null ? `${t(l.temp_min)} … ${t(l.temp_max)} °C` : l.temp_max != null ? `max ${t(l.temp_max)} °C` : l.temp_min != null ? `min ${t(l.temp_min)} °C` : 'limiti non impostati';
  };
  const MSG = {
    locale: 'App in modalità solo locale: le temperature arrivano solo con il cloud configurato.',
    mancante: 'Mancano le tabelle o la funzione delle temperature: eseguire di nuovo supabase/migrazione_temperature.sql nel SQL editor di Supabase.',
    offline: 'Senza internet: le temperature non si possono leggere.',
  };
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/haccp" class="btn">← HACCP</a>
      <label>Mese <input type="month" id="tc-mese" class="st-libero" value="${regT.mese}" max="${oggi.slice(0, 7)}"></label>
      <span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    ${errore ? html`<p class="avviso non-stampa">${MSG[errore.codice] || 'Temperature non disponibili in questo momento.'}</p>` : ''}
    ${nonConformi ? html`<p class="totale non-stampa">⚠ ${nonConformi === 1 ? '1 giorno non conforme' : `${nonConformi} giorni non conformi`}: scrivi nella colonna Note l'azione correttiva (es. "porta rimasta aperta, richiusa, prodotto controllato").</p>` : ''}
    <div class="s6">
      ${testa('REGISTRO TEMPERATURE CELLE FRIGO', `Mese: ${new Date(`${da}T12:00:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })} · rilevazione automatica con sonda ogni 5 minuti`)}
      <p class="s6-legenda">Limiti: ${CELLE.map(c => `${c.nome}: ${limTesto(c)}`).join(' · ')}. Min, max e media del giorno in °C.
        Conforme se la temperatura resta nei limiti (tollerati fino a ${TOLLERANZA_MIN} minuti fuori nel giorno, per aperture della porta).</p>
      <div class="scroll-x"><table class="tab-s6 tab-tempcelle">
        <thead>
          <tr><th rowspan="2">Data</th>${CELLE.map(c => html`<th colspan="3" class="c">${c.nome}</th>`)}<th rowspan="2">Esito</th><th rowspan="2">Note / azione correttiva</th><th rowspan="2">Firma</th></tr>
          <tr>${CELLE.map(() => html`<th class="n">min</th><th class="n">max</th><th class="n">media</th>`)}</tr>
        </thead>
        <tbody>${giorni.map(g => {
          const es = esito(g);
          const n = note.get(g);
          return html`<tr>
            <td>${u.dataIT(g)}</td>
            ${CELLE.map(c => {
              const r = per.get(`${g}|${c.id}`);
              const cls = fuori(r) ? 'n rt-manca' : 'n';
              return html`<td class="${cls}">${r ? t(r.t_min) : ''}</td><td class="${cls}">${r ? t(r.t_max) : ''}</td><td class="n">${r ? t(r.t_media) : ''}</td>`;
            })}
            <td>${es === 'Non conforme' ? html`<b class="rt-manca">Non conforme</b>` : es || html`<span class="totale">nessun dato</span>`}</td>
            <td><input class="tc-nota non-stampa solo-editori" data-giorno="${g}" value="${n?.note || ''}" placeholder="${es === 'Non conforme' ? 'azione correttiva' : ''}"><span class="solo-stampa">${n?.note || ''}</span></td>
            <td>${n?.chi || ''}</td></tr>`;
        })}</tbody>
      </table></div>
    </div>`;
  document.getElementById('tc-mese').onchange = e => { if (e.target.value) { regT.mese = e.target.value; vistaTemperatureCelle(); } };
  document.getElementById('stampa').onclick = () => stampa(`Registro temperature celle ${regT.mese}`);
  const operatori = operatoriDa(await u.db.leggi(ID_OPERATORI));
  document.querySelectorAll('.tc-nota').forEach(inp => inp.onchange = async () => {
    const data = inp.dataset.giorno;
    const id = `notatempcelle-${data}`;
    const prima = note.get(data);
    await u.db.salva({ ...(prima || {}), id, tipo: 'notatempcelle', data, note: inp.value.trim(), chi: prima?.chi || operatori[0] || '' });
    u.toast('Nota salvata');
    vistaTemperatureCelle();
  });
}

// ---------- registro trebbie ----------
const trb = { anno: '' };
export async function vistaTrebbie() {
  const { html } = u;
  const [trebbie, imp] = await Promise.all([u.db.tutti('trebbia'), u.db.leggi(ID_TREBBIE)]);
  const destinatario = destinatarioDa(imp);
  const tutte = registroTrebbie(u.stato.cotte, trebbie, destinatario, u.oggiISO());
  const anni = [...new Set(tutte.map(r => r.data.slice(0, 4)))].sort().reverse();
  if (!trb.anno || !anni.includes(trb.anno)) trb.anno = anni[0] || u.oggiISO().slice(0, 4);
  const righe = tutte.filter(r => r.data.startsWith(trb.anno));
  const tot = totaliTrebbie(righe);
  const destinatari = [...new Set([destinatario, ...trebbie.map(t => t.destinatario).filter(Boolean)])];
  const kg = v => (v == null ? '' : `${u.numIT(v, v % 1 ? 1 : 0)} kg`);
  u.$app.innerHTML = html`
    <div class="barra">
      <a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Registro trebbie</h1><span class="spazio"></span>
      <button id="tr-excel">Scarica Excel</button>
      <button class="primario" id="stampa">Stampa / Salva PDF</button>
    </div>
    <div class="barra non-stampa">
      <div class="segmenti tr-anni">${(anni.length ? anni : [trb.anno]).map(a => html`<button data-anno="${a}" class="${a === trb.anno ? 'attivo' : ''}">${a}</button>`)}</div>
    </div>
    <p class="totale non-stampa">Si compila da solo con ogni cotta fatta: kg = kg di malti della scheda cotta, destinazione = quella di <a href="#/impostazioni">Impostazioni</a> (${destinatario}).
      Se cambi kg, destinazione o note di una riga resta la tua correzione (↺ torna al valore automatico).</p>
    <div class="home-kpi non-stampa">
      <div class="w-kpi" style="--w:var(--ok)"><span>Trebbie ${trb.anno}</span><b>${u.numIT(tot.kg, 0)} kg</b><small>${tot.cotte} ${tot.cotte === 1 ? 'cotta' : 'cotte'}</small></div>
      ${tot.perDestinatario.length < 2 ? '' : tot.perDestinatario.map(x => html`<div class="w-kpi" style="--w:var(--s-pianificata)"><span>${x.destinatario}</span><b>${u.numIT(x.kg, 0)} kg</b><small>${x.cotte} ${x.cotte === 1 ? 'cotta' : 'cotte'}</small></div>`)}
    </div>
    <div class="s6">
      ${testa('REGISTRO TREBBIE', `Anno ${trb.anno} · totale ${u.numIT(tot.kg, 0)} kg in ${tot.cotte} ${tot.cotte === 1 ? 'cotta' : 'cotte'}`)}
      ${righe.length ? html`<div class="scroll-x"><table class="tab-s6 tab-trebbie">
        <thead><tr><th>Data</th><th class="n">Numero cotta</th><th>Birra</th><th class="n">Qtà</th><th>Destinazione</th><th>Note</th><th class="non-stampa"></th></tr></thead>
        <tbody>${righe.map(r => html`<tr>
          <td>${u.dataIT(r.data)}</td>
          <td class="n"><a href="#/cotta/${encodeURIComponent(r.cotta.id)}">${r.numero}</a></td>
          <td>${r.birra}</td>
          <td class="n"><input class="s6-lotto tr-kg" data-tr="${r.cotta.id}|kg" type="number" min="0" step="any" inputmode="decimal" value="${r.kg ?? ''}" placeholder="manca" title="${r.kgMalti ? `Malti della cotta: ${kg(r.kgMalti)}` : 'Nella scheda cotta non ci sono malti'}"></td>
          <td><input class="s6-lotto" data-tr="${r.cotta.id}|destinatario" list="tr-dest" value="${r.destinatario}"></td>
          <td><input class="s6-lotto" data-tr="${r.cotta.id}|note" value="${r.note}" placeholder=""></td>
          <td class="az non-stampa">${r.corretta ? html`<button class="piccolo solo-editori" data-tr-auto="${r.cotta.id}" title="Torna ai valori automatici">↺</button>` : ''}</td></tr>`)}</tbody>
        <tfoot><tr class="c"><td colspan="3">Totale ${trb.anno}</td><td class="n">${kg(tot.kg)}</td><td colspan="3"></td></tr></tfoot></table></div>`
      : html`<p class="vuoto">Nessuna cotta fatta nel ${trb.anno}.</p>`}
      <datalist id="tr-dest">${destinatari.map(d => html`<option value="${d}">`)}</datalist>
    </div>`;

  const riga = id => righe.find(r => r.cotta.id === id);
  u.$app.onchange = async e => {
    const t = e.target;
    if (!t.dataset.tr) return;
    const [id, campo] = t.dataset.tr.split('|');
    const r = riga(id);
    const prima = (await u.db.leggi(idTrebbia(id))) || {};
    const { aggiornato: _a, ...rec } = prima.eliminato ? {} : prima;
    const nuovo = { kg: r.kg, destinatario: r.destinatario, note: r.note, ...rec, id: idTrebbia(id), tipo: 'trebbia', cottaId: id };
    nuovo[campo] = campo === 'kg' ? (t.value === '' ? null : Math.max(0, Number(t.value) || 0)) : t.value.trim();
    if (campo === 'destinatario' && !nuovo.destinatario) nuovo.destinatario = destinatario;
    await u.db.salva(nuovo);
    u.toast('Registro trebbie aggiornato');
    vistaTrebbie();
  };
  u.$app.onclick = async e => {
    const t = e.target;
    const a = t.closest('[data-anno]');
    if (a) { trb.anno = a.dataset.anno; return vistaTrebbie(); }
    const auto = t.closest('[data-tr-auto]');
    if (auto) { await u.db.elimina(idTrebbia(auto.dataset.trAuto)); u.toast('Riga tornata ai valori automatici'); return vistaTrebbie(); }
    if (t.id === 'stampa') return stampa(`Registro trebbie ${trb.anno}`);
    if (t.id === 'tr-excel') return excelTrebbie(tutte);
  };
}

function excelTrebbie(righe) {
  const testa = ['Data', 'Numero cotta', 'Lotto', 'Birra', 'Qtà (kg)', 'Destinazione', 'Note'].map(v => ({ v, grassetto: true, sfondo: 'EEEEEE' }));
  const anni = [...new Set(righe.map(r => r.data.slice(0, 4)))].sort().reverse();
  const fogli = anni.map(a => {
    const del = righe.filter(r => r.data.startsWith(a));
    const tot = totaliTrebbie(del);
    return {
      nome: a,
      righe: [testa, ...del.map(r => [u.dataIT(r.data), r.cotta.numero ?? '', r.cotta.lotto || '', r.birra, r.kg, r.destinatario, r.note]),
        [{ v: 'Totale', grassetto: true }, '', '', '', { v: Math.round(tot.kg * 10) / 10, grassetto: true }, '', ''],
        ...tot.perDestinatario.map(x => ['', '', '', '', Math.round(x.kg * 10) / 10, x.destinatario, `${x.cotte} cotte`])],
      larghezze: [11, 13, 10, 28, 10, 24, 30], blocca: { righe: 1 },
    };
  });
  if (!fogli.length) return u.toast('Nessuna cotta nel registro');
  const blob = creaXlsx(fogli);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `registro-trebbie-${u.oggiISO()}.xlsx`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- schede HACCP: insetti e roditori, esecuzione pulizie ----------
const annate = (oggi, salvate, mese1 = 3) => {
  const da = annataHaccp(`${INIZIO_SCHEDE}-01`, mese1), a = annataHaccp(oggi, mese1);
  const anni = new Set(salvate.map(d => annataHaccp(d, mese1)));
  for (let y = da; y <= a; y++) anni.add(y);
  return [...anni].sort((x, y) => y - x);
};
const segAnnate = (lista, scelta, solare = false) => u.html`<div class="segmenti iss-anni">${lista.map(y => u.html`<button data-annata="${y}" class="${y === scelta ? 'attivo' : ''}">${solare ? y : `${y}/${y + 1}`}</button>`)}</div>`;

const inf = { annata: null, mese: '' };
export async function vistaInfestanti() {
  const { html } = u;
  const oggi = u.oggiISO();
  const [salvate, opRec] = await Promise.all([u.db.tutti('infestanti'), u.db.leggi(ID_OPERATORI)]);
  const operatori = operatoriDa(opRec);
  const lista = annate(oggi, salvate.map(x => `${x.mese}-01`));
  if (!lista.includes(inf.annata)) inf.annata = annataHaccp(oggi);
  const schede = mesiAnnata(inf.annata).map(m => schedaInfestanti(m, salvate, operatori[0], oggi)).filter(Boolean);
  if (!schede.some(x => x.mese === inf.mese)) inf.mese = schede.at(-1)?.mese || '';
  const i = schede.findIndex(x => x.mese === inf.mese);
  const presenze = sc => VOCI_INFESTANTI.filter(([k]) => sc.voci?.[k] === 'presenza').length;
  const foglio = (sc, attuale) => html`<div class="s6 iss-foglio iss-pag ${attuale ? '' : 'iss-altro'}">
    ${testa('MONITORAGGIO INSETTI E RODITORI', `Mese di ${meseLungo(sc.mese)} · annata ${inf.annata}/${inf.annata + 1}`)}
    <table class="tab-s6 iss-tab iss-inf"><thead><tr><th></th><th class="c">Assenza</th><th class="c">Presenza</th></tr></thead>
      <tbody>${VOCI_INFESTANTI.map(([k, n]) => { const v = sc.voci?.[k] || 'assenza'; return html`<tr class="${v === 'presenza' ? 'iss-presenza' : ''}"><td>${n}</td>
        <td class="c"><span class="iss-box" role="button" tabindex="0" data-inf="${sc.mese}|${k}|assenza" aria-pressed="${v === 'assenza'}">${v === 'assenza' ? '☒' : '☐'}</span></td>
        <td class="c"><span class="iss-box" role="button" tabindex="0" data-inf="${sc.mese}|${k}|presenza" aria-pressed="${v === 'presenza'}">${v === 'presenza' ? '☒' : '☐'}</span></td></tr>`; })}</tbody></table>
    <p class="iss-firma">Controllato da: <select class="s6-lotto" data-inf-chi="${sc.mese}">${opzioniOperatori(operatori, sc.chi).map(n => html`<option ${n === sc.chi ? 'selected' : ''}>${n}</option>`)}</select>
      <span class="iss-note">Note / azioni: <input class="s6-lotto" data-inf-note="${sc.mese}" value="${sc.note || ''}" placeholder="${presenze(sc) ? 'scrivi cosa hai trovato e cosa hai fatto' : ''}"></span></p>
  </div>`;
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Insetti e roditori</h1><span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button></div>
    <div class="barra non-stampa">${segAnnate(lista, inf.annata)}</div>
    <p class="totale non-stampa">Ogni mese, dal ${meseLungo(INIZIO_SCHEDE)}, la scheda si compila da sola con tutto "Assenza" e il primo operatore di <a href="#/impostazioni">Impostazioni</a>. Tocca "Presenza" se trovi qualcosa e scrivi cosa hai fatto. In stampa escono tutti i mesi dell'annata, uno per foglio.</p>
    ${schede.length > 1 ? html`<div class="barra non-stampa s6-pagine"><button id="inf-prec" ${i > 0 ? '' : 'disabled'} aria-label="Mese prima">◀</button>
      <span><b>${meseLungo(inf.mese)}</b>${presenze(schede[i]) ? html` <span class="rt-manca">${presenze(schede[i])} presenze</span>` : ''}</span>
      <button id="inf-succ" ${i < schede.length - 1 ? '' : 'disabled'} aria-label="Mese dopo">▶</button></div>` : ''}
    ${schede.length ? schede.map(sc => foglio(sc, sc.mese === inf.mese)) : html`<p class="vuoto">Nessuna scheda in questa annata.</p>`}`;
  const salvaScheda = async (mese, campi) => {
    const sc = schede.find(x => x.mese === mese);
    const { aggiornato: _a, auto: _b, ...rec } = sc;
    await u.db.salva({ ...rec, ...campi });
    vistaInfestanti();
  };
  u.$app.onclick = async e => {
    const t = e.target;
    const a = t.closest('[data-annata]');
    if (a) { inf.annata = Number(a.dataset.annata); inf.mese = ''; return vistaInfestanti(); }
    if (t.id === 'inf-prec') { inf.mese = schede[i - 1].mese; return vistaInfestanti(); }
    if (t.id === 'inf-succ') { inf.mese = schede[i + 1].mese; return vistaInfestanti(); }
    if (t.id === 'stampa') return stampa(`Monitoraggio insetti e roditori ${inf.annata}-${inf.annata + 1}`);
    const b = t.closest('[data-inf]');
    if (b && !document.body.classList.contains('lettore')) {
      const [mese, k, v] = b.dataset.inf.split('|');
      const sc = schede.find(x => x.mese === mese);
      return salvaScheda(mese, { voci: { ...sc.voci, [k]: v } });
    }
  };
  u.$app.onchange = e => {
    const t = e.target;
    if (t.dataset.infChi) return salvaScheda(t.dataset.infChi, { chi: t.value });
    if (t.dataset.infNote !== undefined) return salvaScheda(t.dataset.infNote, { note: t.value.trim() });
  };
}

const pamb = { annata: null };
export async function vistaPulizieAmbienti() {
  const { html } = u;
  const oggi = u.oggiISO();
  const [salvate, opRec] = await Promise.all([u.db.tutti('puliziaambiente'), u.db.leggi(ID_OPERATORI)]);
  const operatori = operatoriDa(opRec);
  // anno solare, gennaio-dicembre (Romain 2026-10-20)
  const lista = annate(oggi, salvate.map(x => x.data).filter(Boolean), 1);
  if (!lista.includes(pamb.annata)) pamb.annata = annataHaccp(oggi, 1);
  const mesi = mesiAnnata(pamb.annata, 1);
  const perMese = new Map(mesi.map(m => [m, pulizieAmbientiMese(m, salvate, operatori[0], oggi)]));
  const fatte = [...perMese.values()].reduce((t, x) => t + x.size, 0);
  u.$app.innerHTML = html`
    <div class="barra"><a href="#/haccp" class="btn">← HACCP</a><h1 style="margin:0">Esecuzione pulizie</h1><span class="spazio"></span>
      <button class="primario" id="stampa">Stampa / Salva PDF</button></div>
    <div class="barra non-stampa">${segAnnate(lista, pamb.annata, true)}</div>
    <p class="totale non-stampa">Dal ${meseLungo(INIZIO_SCHEDE)} si compila da sola: "sì" e la sigla del primo operatore di <a href="#/impostazioni">Impostazioni</a> il giorno ${GIORNI_PULIZIA_AMBIENTI.join(' e ')} di ogni mese (sabato e domenica vanno al venerdì). Tocca un giorno per aggiungere una pulizia, tocca un "sì" per toglierlo. ${fatte} pulizie nell'anno.</p>
    <div class="s6 iss-foglio">
      ${testa('ESECUZIONE PULIZIE', `Anno ${pamb.annata} · sì e sigla di chi l'ha fatta`)}
      <div class="scroll-x"><table class="tab-s6 iss-tab iss-griglia">
        <thead><tr><th>DATA</th>${mesi.map(m => html`<th class="c">${meseCorto(m)}</th>`)}</tr></thead>
        <tbody>${Array.from({ length: 31 }, (_, g) => html`<tr><td class="c"><b>${g + 1}</b></td>${mesi.map(m => {
          if (g + 1 > giorniDelMese(m)) return html`<td class="iss-no"></td>`;
          const d = `${m}-${String(g + 1).padStart(2, '0')}`;
          const x = perMese.get(m).get(d);
          return html`<td class="c ${x ? 'iss-si' : ''}" data-pamb="${d}" title="${x ? `Pulizia del ${u.dataIT(d)}${x.auto ? ' (automatica)' : ''}: tocca per togliere` : `Tocca per segnare la pulizia del ${u.dataIT(d)}`}">${x ? `sì ${sigla(x.chi)}` : ''}</td>`;
        })}</tr>`)}</tbody></table></div>
    </div>`;
  u.$app.onclick = async e => {
    const t = e.target;
    const a = t.closest('[data-annata]');
    if (a) { pamb.annata = Number(a.dataset.annata); return vistaPulizieAmbienti(); }
    if (t.id === 'stampa') return stampa(`Esecuzione pulizie ${pamb.annata}`);
    const c = t.closest('[data-pamb]');
    if (!c || document.body.classList.contains('lettore')) return;
    const d = c.dataset.pamb;
    const x = perMese.get(d.slice(0, 7)).get(d);
    await u.db.salva({ id: `pamb-${d}`, tipo: 'puliziaambiente', data: d, fatta: !x, chi: x ? x.chi : operatori[0] });
    vistaPulizieAmbienti();
  };
}
