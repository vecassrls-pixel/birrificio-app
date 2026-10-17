// "Chiedi ai dati" (#/chiedi): domande in italiano su cotte, magazzino e vendite, risponde Claude
// con i dati del database (netlify/functions/ai.mjs, azione 'domanda').

import { chiediAi } from './ai.js';

let u; // { $app, html, raw, toast }
export function init(strumenti) { u = strumenti; }

const ESEMPI = [
  'Quanti litri di WOJTEK abbiamo prodotto quest\'anno?',
  'Qual è la FG media delle ultime 5 cotte di ogni birra?',
  'Chi sono i 10 clienti che hanno comprato più litri negli ultimi 6 mesi?',
  'Quanto malto pils abbiamo usato al mese quest\'anno?',
  'Quali birre hanno avuto la resa in litri più bassa?',
];
const storia = []; // { role, content } della conversazione aperta (si perde ricaricando la pagina)
let inCorso = false;

// Markdown essenziale delle risposte: grassetto, corsivo, codice, elenchi, tabelle
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
export function markdown(testo) {
  const righe = String(testo).split('\n');
  const out = [];
  for (let i = 0; i < righe.length; i++) {
    const r = righe[i];
    if (/^\s*\|.*\|\s*$/.test(r)) { // tabella
      const t = [];
      while (i < righe.length && /^\s*\|.*\|\s*$/.test(righe[i])) t.push(righe[i++]);
      i--;
      const celle = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const corpo = t.filter((x, j) => !(j === 1 && /^[\s|:-]+$/.test(x)));
      const num = c => /^[-+]?[\d.,]+\s*(%|L|kg|g|€|hl)?$/i.test(c);
      out.push(`<div class="scroll-x"><table class="tab-mag"><thead><tr>${celle(corpo[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${corpo.slice(1).map(x => `<tr>${celle(x).map(c => `<td${num(c) ? ' class="n"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(r)) { // elenco
      const ord = /^\s*\d+\./.test(r);
      const v = [];
      while (i < righe.length && /^\s*([-*]|\d+\.)\s+/.test(righe[i])) v.push(righe[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      i--;
      out.push(`<${ord ? 'ol' : 'ul'}>${v.map(x => `<li>${inline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`);
    } else if (/^#{1,4}\s/.test(r)) out.push(`<h3>${inline(r.replace(/^#+\s/, ''))}</h3>`);
    else if (r.trim()) out.push(`<p>${inline(r)}</p>`);
  }
  return out.join('');
}

export function vistaChiedi() {
  const { html, raw } = u;
  const disegna = () => {
    u.$app.innerHTML = html`
      <div class="barra"><a href="#/home" class="btn">← Home</a><span class="spazio"></span>
        ${storia.length ? html`<button id="ch-nuova" ${inCorso ? 'disabled' : ''}>Nuova conversazione</button>` : ''}</div>
      <h1>Chiedi ai dati</h1>
      <p class="totale">Fai una domanda su cotte, ricette, magazzino, vendite e clienti: risponde Claude leggendo i dati dell'app di oggi. Controlla i numeri importanti prima di usarli.</p>
      <div class="chiedi">
        ${!storia.length ? html`<div class="chiedi-esempi">${ESEMPI.map(e => html`<button class="piccolo" data-es="${e}">${e}</button>`)}</div>` : ''}
        ${storia.map((m, i) => (m.role === 'user'
          ? html`<div class="ch-domanda">${m.content}</div>`
          : html`<div class="ch-risposta scheda" ${i === storia.length - 1 ? raw('id="ch-ultima"') : ''}>${raw(markdown(m.content) || (m.errore ? '' : '<p class="totale">Sto guardando i dati…</p>'))}${m.errore ? html`<p class="errore">${m.errore}</p>` : ''}</div>`))}
        <form id="ch-form" class="ch-form">
          <textarea id="ch-testo" rows="2" placeholder="Scrivi la domanda…" ${inCorso ? 'disabled' : ''}></textarea>
          <button class="primario" ${inCorso ? 'disabled' : ''}>${inCorso ? 'Rispondo…' : 'Chiedi'}</button>
        </form>
      </div>`;
    const testo = u.$app.querySelector('#ch-testo');
    u.$app.querySelector('#ch-form').onsubmit = e => { e.preventDefault(); manda(testo.value); };
    testo.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); manda(testo.value); } };
    if (!inCorso) testo.focus();
  };
  async function manda(domanda) {
    domanda = domanda.trim();
    if (!domanda || inCorso) return;
    const prima = storia.filter(m => !m.errore).map(({ role, content }) => ({ role, content }));
    storia.push({ role: 'user', content: domanda }, { role: 'assistant', content: '' });
    const risposta = storia[storia.length - 1];
    inCorso = true;
    disegna();
    try {
      await chiediAi({ azione: 'domanda', domanda, storia: prima }, {
        suTesto: t => {
          risposta.content = t;
          const el = document.getElementById('ch-ultima');
          if (el) el.innerHTML = markdown(t);
        },
      });
    } catch (e) {
      risposta.errore = e.message;
      storia[storia.length - 2].errore = true; // domanda senza risposta: non va nella conversazione
    }
    inCorso = false;
    if (location.hash === '#/chiedi') disegna();
  }
  disegna();
  u.$app.onclick = e => {
    const es = e.target.closest('[data-es]');
    if (es) return manda(es.dataset.es);
    if (e.target.id === 'ch-nuova') { storia.length = 0; disegna(); }
  };
}
