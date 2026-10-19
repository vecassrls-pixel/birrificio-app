// Modalità simulazione: letture finte ma realistiche, per provare l'app senza l'hardware.
// Ogni FV ha un setpoint (fermentazione, dry hop, freddo) e un "freddo" che si accende sopra setpoint + isteresi
// e si spegne al setpoint, come un vero termostato. Le righe hanno fonte = 'simulazione' (si cancellano con una query,
// vedi supabase/migrazione_temperature.sql).

const SETPOINT = [19, 18, 12, 2, 1, 20, 18, 4, 0.5, 19, 16];
const SETPOINT_CELLE = { CELLA1: 4, CELLA2: 4, 'FRIGO-LUPPOLI': 2 };
const FV_DEFAULT = [...Array.from({ length: 10 }, (_, i) => `FV${i + 1}`), ...Object.keys(SETPOINT_CELLE)]; // FV11 non ancora collegato

export class SorgenteSimulata {
  constructor(elencoFv = FV_DEFAULT) {
    this.fonte = 'simulazione';
    this.stati = elencoFv.map((fv, i) => {
      const sp = SETPOINT_CELLE[fv] ?? SETPOINT[i % SETPOINT.length];
      return { fv, sp, t: sp + Math.random() * 0.8, freddo: false, isteresi: 0.5 };
    });
  }

  static passo(s, secondi, ambiente = 20) {
    // il calore della fermentazione e dell'ambiente scalda, il glicole raffredda
    const riscaldamento = 0.004 + Math.max(0, ambiente - s.t) * 0.0004;
    s.t += (riscaldamento - (s.freddo ? 0.02 : 0)) * secondi / 15 + (Math.random() - 0.5) * 0.01;
    if (s.t >= s.sp + s.isteresi) s.freddo = true;
    if (s.t <= s.sp) s.freddo = false;
  }

  leggi() {
    return Promise.resolve(this.stati.map(s => {
      SorgenteSimulata.passo(s, 15);
      return { fv: s.fv, temperatura: Math.round(s.t * 100) / 100, setpoint: s.sp, raffreddamento: s.freddo, errore: null, fonte: this.fonte };
    }));
  }

  chiudi() {}

  // Storico finto degli ultimi `giorni` giorni (una riga ogni `minuti`), con un profilo di cotta:
  // fermentazione a 19-20 °C, dry hop, poi freddo a 1 °C.
  storico(giorni, minuti = 5, adesso = Date.now()) {
    const righe = [];
    const passo = minuti * 60_000;
    const fine = Math.floor(adesso / passo) * passo;
    for (const [i, s0] of this.stati.entries()) {
      const s = { ...s0, t: 19, freddo: false };
      for (let ts = fine - giorni * 86_400_000; ts <= fine; ts += passo) {
        const giorno = Math.floor((ts - (fine - giorni * 86_400_000)) / 86_400_000) + ((i * 5) % 30);
        s.sp = giorno % 34 < 10 ? 19 : giorno % 34 < 14 ? 18 : 1;
        let acceso = 0;
        for (let k = 0; k < minuti * 4; k++) { SorgenteSimulata.passo(s, 15); if (s.freddo) acceso++; }
        righe.push({
          fv: s.fv, ts: new Date(ts).toISOString(), temperatura: Math.round(s.t * 100) / 100, setpoint: s.sp,
          raffreddamento: acceso > 0, raffreddamento_pct: Math.round(acceso / (minuti * 4) * 100), fonte: this.fonte,
        });
      }
    }
    return righe;
  }
}
