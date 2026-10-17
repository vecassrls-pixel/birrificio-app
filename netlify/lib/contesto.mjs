// I dati del birrificio in forma di testo compatto (tabelle separate da ;) per "Chiedi ai dati":
// cotte, fermentatori, materie prime, birra in magazzino, vendite e acquisti.
// I calcoli sono gli stessi dell'app (moduli in js/).

import { abv, addGiorni, fineCotta, statoCotta } from '../../js/dominio.js';
import { giacenze } from '../../js/magazzino.js';
import { daChiave, giacenzeBirra, rinominati } from '../../js/birra.js';
import { statoClienti } from '../../js/previsioni.js';

const MAX = 600_000; // caratteri: oltre si tagliano le cotte più vecchie
const n = (x, dec = 1) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? '' : String(Math.round(Number(x) * 10 ** dec) / 10 ** dec));
const pulisci = s => String(s ?? '').replace(/[;\n\r]+/g, ' ').trim();
const ingredienti = v => (v || []).filter(x => x?.nome).map(x => `${pulisci(x.nome)} ${n(x.qta, 2)}${x.unita || ''}`).join(', ');
const tabella = (titolo, intestazione, righe) => `## ${titolo}\n${intestazione}\n${righe.join('\n') || '(nessuna riga)'}\n`;

export function contestoDati(dati, oggi) {
  const { durate } = dati;
  const cotte = dati.cotte.filter(c => !c.eliminato && c.data).sort((a, b) => a.data.localeCompare(b.data));
  const sez = [];

  sez.push(tabella('Fermentatori', 'nome;capacita_L;isobarico', dati.fv.map(f => [f.nome, n(f.capacita, 0), f.isobarico === false ? 'no' : 'si'].join(';'))));

  // magazzino materie prime
  const giacMp = giacenze({ articoli: dati.articoli, bolle: dati.bolle, inventari: dati.inventari, cotte: dati.cotte, scarichi: dati.scarichi }, oggi);
  sez.push(tabella('Materie prime in magazzino oggi', 'articolo;categoria;unita;giacenza;impegnato_cotte_future;scorta_minima',
    [...giacMp.values()].filter(g => !g.articolo.eliminato).map(g => [pulisci(g.articolo.nome), g.articolo.categoria || '', g.articolo.unita, n(g.giacenza, 2), n(g.impegnato, 2), n(g.articolo.scortaMin, 2)].join(';'))));

  // acquisti (bolle) degli ultimi 2 anni
  const nomi = new Map(dati.articoli.map(a => [a.id, a.nome]));
  const daBolle = addGiorni(oggi, -730);
  sez.push(tabella('Bolle dei fornitori (ultimi 2 anni)', 'data;fornitore;numero;articolo;qta;unita;lotto',
    dati.bolle.filter(b => !b.eliminato && b.data >= daBolle).sort((a, b) => a.data.localeCompare(b.data))
      .flatMap(b => (b.righe || []).map(r => [b.data, pulisci(b.fornitore), pulisci(b.numero), pulisci(nomi.get(r.articoloId) || r.descrizione), n(r.qta, 2), r.unita || '', pulisci(r.lotto)].join(';')))));

  // birra finita in magazzino
  const datiBirra = { cotte: dati.cotte, durate, movimenti: dati.movimenti, inventari: dati.inventariBirra, prodotti: dati.prodotti, impostazioni: dati.impBirra };
  if (dati.impBirra?.inizio) {
    const giacB = giacenzeBirra(datiBirra, oggi);
    sez.push(tabella(`Birra finita in magazzino oggi (magazzino birra avviato il ${dati.impBirra.inizio})`, 'birra;formato;litri_per_pezzo;pezzi;litri',
      [...giacB.values()].filter(g => g.giacenza).map(g => [g.birra, g.tipo, n(g.litri, 1), n(g.giacenza, 0), n(g.giacenza * g.litri, 0)].join(';'))));
  } else sez.push('## Birra finita in magazzino\nIl magazzino birra non è ancora avviato (manca il primo inventario): le giacenze di birra finita non sono note.\n');

  // vendite e altri movimenti della birra
  const al = rinominati(dati.prodotti);
  const movimenti = dati.movimenti.filter(m => !m.eliminato && !m.ignorato && m.data).sort((a, b) => a.data.localeCompare(b.data));
  sez.push(tabella('Movimenti manuali e importati della birra finita (vendite da fatture/Shopify, taproom, resi…)', 'data;verso;motivo;cliente;documento;birra;formato;litri_per_pezzo;pezzi;lotto',
    movimenti.flatMap(m => (m.righe || []).map(r => {
      const p = daChiave(al.get(r.prodotto) || r.prodotto || '');
      return [m.data, m.verso || 'scarico', m.motivo || '', pulisci(m.cliente), pulisci(m.documento), p.birra, p.tipo, n(p.litri, 1), n(r.pezzi, 0), pulisci(r.lotto)].join(';');
    }))));
  const clienti = statoClienti(dati.movimenti, dati.clienti, dati.prodotti, oggi);
  sez.push(tabella('Clienti (dalle vendite)', 'cliente;ordini;ultimo_ordine;giorni_dall_ultimo;ordina_di_solito_ogni_giorni;da_richiamare;litri_totali;birre_preferite',
    clienti.map(c => [pulisci(c.nome), c.ordini, c.ultimo, c.giorni, c.ritmo ?? '', c.daRichiamare ? 'si' : 'no', n(c.litri, 0), c.birre.join(', ')].join(';'))));

  // cotte: le più recenti per prime se bisogna tagliare
  const righeCotte = cotte.map(c => {
    const fine = fineCotta(c, durate);
    return [c.lotto || '', c.data, pulisci(c.birra), c.fv || '', n(c.litri, 0), n(c.og, 1), n(c.fg, 1), c.og && c.fg ? n(abv(c.og, c.fg), 1) : '', statoCotta(c, durate, oggi, dati.cotte), fine,
      n(c.phMash, 2), ingredienti(c.malti), ingredienti(c.luppoli), ingredienti(c.lievito), pulisci(c.note).slice(0, 200)].join(';');
  });
  const intestaCotte = 'lotto;data_cotta;birra;fv;litri;og_plato;fg_plato;abv;stato;fine_in_fv;ph_mash;malti;luppoli;lievito;note';
  const resto = sez.join('\n');
  let tenute = righeCotte;
  while (tenute.length > 50 && resto.length + tenute.join('\n').length > MAX) tenute = tenute.slice(Math.ceil(tenute.length / 5));
  const nota = tenute.length < righeCotte.length ? ` (solo le ultime ${tenute.length} di ${righeCotte.length})` : '';
  return [`Oggi è il ${oggi}. Birrificio Kashmir Brewing Company. Plato per OG/FG, litri, date AAAA-MM-GG.\n`,
    tabella(`Cotte${nota}`, intestaCotte, tenute), resto].join('\n');
}
