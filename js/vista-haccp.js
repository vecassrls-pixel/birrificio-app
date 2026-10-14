// Pagina HACCP: registri e controlli dell'autocontrollo igienico. Per ora il registro S6
// (carico e scarico materie prime con i lotti); le altre schede arriveranno qui.

let u; // { $app, html }
export function init(strumenti) { u = strumenti; }

export function vistaHaccp() {
  const { html } = u;
  u.$app.innerHTML = html`
    <div class="barra"><div><h1 style="margin:0">HACCP</h1>
      <p class="totale" style="margin:2px 0 0">Registri e controlli del piano di autocontrollo.</p></div></div>
    <div class="haccp-griglia">
      <a class="widget haccp-voce" href="#/registro-s6">
        <span class="haccp-ico" aria-hidden="true">📒</span>
        <span><b>Registro S6</b><small>Carico e scarico delle materie prime con lotti e scadenze, per settimana. Da stampare.</small></span>
        <span class="haccp-vai" aria-hidden="true">→</span>
      </a>
    </div>`;
}
