// Impostazioni → "Automazioni e Telegram": cosa fa il server da solo (agenda, report, import, allarmi),
// a che ora e in quale chat. Le scelte sono il record 'impostazione-automazioni' (js/automazioni.js);
// le prove partono dalla funzione netlify/functions/automazioni.mjs.

import { ID_IMP, ID_STATO, impostazioni } from './automazioni.js';
import { ID_IMPOSTAZIONI } from './birra.js';
import { testoAgenda } from './riepilogo.js';
import { token } from './auth.js';

let u; // { html, raw, db, toast, stato, oggiISO }
export function init(strumenti) { u = strumenti; }

// I dati per agenda e Home, letti da questo dispositivo (stessa forma di datiBirrificio sul server)
export async function datiLocali() {
  const tipi = ['articolo', 'bolla', 'inventario', 'scarico', 'movbirra', 'inventariobirra', 'prodottobirra', 'scadenzahaccp', 'pulizia', 'importsospeso', 'cliente', 'ordinecliente'];
  const [l, impBirra] = await Promise.all([Promise.all(tipi.map(t => u.db.tutti(t))), u.db.leggi(ID_IMPOSTAZIONI)]);
  const t = Object.fromEntries(tipi.map((k, i) => [k, l[i]]));
  return {
    cotte: u.stato.cotte, fv: u.stato.fv, durate: u.stato.durate,
    articoli: t.articolo, bolle: t.bolla, inventari: t.inventario, scarichi: t.scarico, movimenti: t.movbirra,
    inventariBirra: t.inventariobirra, prodotti: t.prodottobirra, impBirra: impBirra && !impBirra.eliminato ? impBirra : null,
    scadenze: t.scadenzahaccp, pulizie: t.pulizia, sospesi: t.importsospeso, clienti: t.cliente, ordini: t.ordinecliente,
  };
}

async function server(metodo, corpo) {
  const t = await token();
  const res = await fetch('/.netlify/functions/automazioni', {
    method: metodo, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  let body = null;
  try { body = await res.json(); } catch { /* app non pubblicata su Netlify */ }
  if (!res.ok || !body) throw new Error(body?.errore || (res.status === 404 ? 'Le automazioni girano solo sull\'app pubblicata su Netlify' : `Errore ${res.status}`));
  return body;
}

// HTML di Telegram (<b>, <i>, <a>) → HTML della pagina, per l'anteprima
const daTelegram = t => t.replace(/\n/g, '<br>').replace(/<a href="[^"]*">([^<]*)<\/a>/g, '<u>$1</u>');
const quando = iso => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const ORE = Array.from({ length: 24 }, (_, h) => h);

export async function scheda(box) {
  const { html, raw } = u;
  let conf = null, errConf = '';
  try { conf = await server('GET'); } catch (e) { errConf = e.message; }
  const disegna = async () => {
    const imp = impostazioni(await u.db.leggi(ID_IMP));
    const st = (await u.db.leggi(ID_STATO)) || {};
    const ok = v => (v ? '✓' : '✗');
    const esito = x => (!x ? 'mai' : x.ok === false ? `errore il ${quando(x.quando)}: ${x.errore}` : `inviato il ${quando(x.quando)}`);
    const aperti = Object.entries(st.allarmi || {}).filter(([k, a]) => k !== '_gateway' && a.inviato);
    const oraSel = (k, sotto, v) => html`<select data-imp="${k}.${sotto}">${ORE.map(h => html`<option value="${h}" ${h === v ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`)}</select>`;
    box.innerHTML = html`
      <h2>Automazioni e Telegram</h2>
      <p class="totale">Il server lavora anche ad app chiusa: ogni mattina manda l'agenda su Telegram, il lunedì il report della settimana, di notte importa vendite e acquisti, e ogni ora controlla le temperature dei fermentatori.</p>
      ${conf ? html`<p class="totale">Sul server: Telegram ${ok(conf.telegram)} · database ${ok(conf.database)} · Fatture in Cloud ${ok(conf.fic)} · Shopify ${ok(conf.shopify)} · AI ${ok(conf.ai)}</p>
        ${!conf.telegram ? html`<p class="avviso">Telegram non è collegato: crea un bot con @BotFather, metti il suo token in TELEGRAM_BOT_TOKEN su Netlify e aggiungi il bot al gruppo del birrificio.</p>` : ''}`
      : html`<p class="totale">${errConf}</p>`}
      <div class="griglia">
        <label style="grid-column:span 2">Chat o gruppo Telegram (id)<input data-imp="chatId" value="${imp.chatId}" placeholder="es. -1001234567890 (vuoto: TELEGRAM_CHAT_ID)"></label>
      </div>
      <div class="barra"><button class="piccolo" id="au-chat">Trova il gruppo</button><button class="piccolo" id="au-prova">Manda un messaggio di prova</button></div>
      <div id="au-chat-elenco"></div>
      <table class="tab-mag au-tab"><tbody>
        <tr><td><label class="spunta"><input type="checkbox" data-imp="agenda.attiva" ${imp.agenda.attiva ? 'checked' : ''}> ☀️ Agenda del mattino</label></td>
          <td>alle ${raw(oraSel('agenda', 'ora', imp.agenda.ora))}</td><td class="totale">${esito(st.agenda)}</td>
          <td class="az"><button class="piccolo" data-manda="agenda">Manda ora</button></td></tr>
        <tr><td><label class="spunta"><input type="checkbox" data-imp="report.attivo" ${imp.report.attivo ? 'checked' : ''}> 📊 Report del lunedì</label></td>
          <td>alle ${raw(oraSel('report', 'ora', imp.report.ora))}</td><td class="totale">${esito(st.report)}</td>
          <td class="az"><button class="piccolo" data-manda="report">Manda ora</button></td></tr>
        <tr><td><label class="spunta"><input type="checkbox" data-imp="importa.attivo" ${imp.importa.attivo ? 'checked' : ''}> 📥 Import vendite e acquisti</label></td>
          <td>alle ${raw(oraSel('importa', 'ora', imp.importa.ora))}</td>
          <td class="totale">${st.importa?.ultimo ? `ultimo il ${quando(st.importa.ultimo)}: ${st.importa.movimenti || 0} movimenti, ${st.importa.sospesi || 0} da controllare, ${st.importa.acquisti || 0} acquisti${st.importa.errori?.length ? ` · errori: ${st.importa.errori.join('; ')}` : ''}` : 'mai'}</td>
          <td class="az"><button class="piccolo" data-manda="importa">Importa ora</button></td></tr>
        <tr><td><label class="spunta"><input type="checkbox" data-imp="allarmi.attivi" ${imp.allarmi.attivi ? 'checked' : ''}> 🚨 Allarmi temperatura FV</label></td>
          <td>ogni ora</td><td class="totale">${aperti.length ? `aperti: ${aperti.map(([fv]) => fv).join(', ')}` : 'nessun allarme aperto'}</td><td></td></tr>
      </tbody></table>
      <div class="griglia" style="margin-top:8px">
        <label>Vendite da Fatture in Cloud<select data-imp="importa.vendite">
          <option value="fatture" ${imp.importa.vendite === 'fatture' ? 'selected' : ''}>dalle fatture (e ricevute)</option>
          <option value="ddt" ${imp.importa.vendite === 'ddt' ? 'selected' : ''}>dai DDT (e ricevute)</option></select></label>
        <label class="spunta"><input type="checkbox" data-imp="importa.shopify" ${imp.importa.shopify ? 'checked' : ''}> Ordini Shopify spediti</label>
        <label class="spunta"><input type="checkbox" data-imp="importa.acquisti" ${imp.importa.acquisti ? 'checked' : ''}> Fatture dei fornitori (diventano bolle da confermare)</label>
      </div>
      <p class="totale">Fatture o DDT: scegline uno solo, altrimenti la stessa vendita esce due volte dal magazzino. I documenti con prodotti non riconosciuti aspettano in Birra → Importa.</p>
      <details class="au-anteprima"><summary>Anteprima dell'agenda di oggi</summary><div id="au-ag" class="tg-msg">Preparo…</div></details>`;
  };
  await disegna();
  box.onchange = async e => {
    const t = e.target;
    if (!t.dataset.imp) return;
    const rec = (await u.db.leggi(ID_IMP)) || { id: ID_IMP, tipo: 'impostazioneautomazioni' };
    const { aggiornato: _a, ...base } = rec;
    const v = t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' && /\.ora$/.test(t.dataset.imp) ? Number(t.value) : t.value.trim();
    const [k, sotto] = t.dataset.imp.split('.');
    const nuovo = { ...base, eliminato: false };
    if (sotto) nuovo[k] = { ...impostazioni(rec)[k], [sotto]: v }; else nuovo[k] = v;
    await u.db.salva(nuovo);
    u.toast('Salvato: vale dal prossimo giro del server');
  };
  box.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    const azione = b.id === 'au-prova' ? 'prova' : b.id === 'au-chat' ? 'chat' : b.dataset.manda;
    if (!azione) {
      const c = e.target.closest('[data-chatid]');
      if (c) { const inp = box.querySelector('[data-imp="chatId"]'); inp.value = c.dataset.chatid; inp.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    b.disabled = true;
    try {
      const r = await server('POST', { azione });
      if (azione === 'chat') {
        box.querySelector('#au-chat-elenco').innerHTML = (r.chat?.length
          ? html`<p class="totale">Tocca il gruppo giusto:</p><div class="barra">${r.chat.map(c => html`<button class="piccolo" data-chatid="${c.id}">${c.nome || c.id}${c.tipo === "private" ? " (privata)" : ""}</button>`)}</div>`
          : html`<p class="totale">Nessuna chat recente: aggiungi il bot al gruppo, scrivi un messaggio nel gruppo e riprova.</p>`).s;
      } else if (azione === 'importa') {
        const x = r.esito || {};
        u.toast(`Import fatto: ${x.movimenti || 0} movimenti, ${x.sospesi || 0} da controllare, ${x.acquisti || 0} acquisti`);
      } else u.toast('Mandato su Telegram');
      if (azione !== 'chat') setTimeout(disegna, 1500); // lo stato arriva con la sincronizzazione
    } catch (ex) { u.toast(ex.message); }
    b.disabled = false;
  };
  box.addEventListener('toggle', async e => {
    if (e.target.className !== 'au-anteprima' || !e.target.open) return;
    const el = box.querySelector('#au-ag');
    try { el.innerHTML = daTelegram(testoAgenda(await datiLocali(), u.oggiISO())); } catch (ex) { el.textContent = ex.message; }
  }, true);
}
