// Messaggi su Telegram con il bot del birrificio (gratis, anche ad app chiusa).
// Variabili d'ambiente Netlify:
//   TELEGRAM_BOT_TOKEN  token del bot (da @BotFather su Telegram)
//   TELEGRAM_CHAT_ID    id del gruppo (o della persona) che riceve i messaggi; si può anche scrivere
//                       in Impostazioni → Automazioni (vale quello dell'app se c'è)

export const configurato = () => !!process.env.TELEGRAM_BOT_TOKEN;

async function chiama(metodo, corpo) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${metodo}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok || !b.ok) throw new Error(`Telegram: ${b.description || res.status}`);
  return b.result;
}

// Testo in HTML di Telegram; oltre 4096 caratteri si divide su più messaggi (a fine riga)
export async function invia(testo, chatId = process.env.TELEGRAM_CHAT_ID) {
  if (!configurato()) throw new Error('Telegram non configurato: manca TELEGRAM_BOT_TOKEN su Netlify');
  if (!chatId) throw new Error('Manca l\'id della chat Telegram (Impostazioni → Automazioni)');
  const pezzi = [];
  let resto = testo;
  while (resto.length > 4000) {
    const taglio = resto.lastIndexOf('\n', 4000) > 0 ? resto.lastIndexOf('\n', 4000) : 4000;
    pezzi.push(resto.slice(0, taglio));
    resto = resto.slice(taglio).replace(/^\n/, '');
  }
  pezzi.push(resto);
  for (const p of pezzi) await chiama('sendMessage', { chat_id: chatId, text: p, parse_mode: 'HTML', disable_web_page_preview: true });
}

// Ultime chat che hanno scritto al bot: per trovare l'id del gruppo senza strumenti esterni
export async function chatRecenti() {
  if (!configurato()) throw new Error('Telegram non configurato: manca TELEGRAM_BOT_TOKEN su Netlify');
  const agg = await chiama('getUpdates', { limit: 50, allowed_updates: ['message', 'my_chat_member'] });
  const chat = new Map();
  for (const u of agg) {
    const c = u.message?.chat || u.my_chat_member?.chat;
    if (c) chat.set(String(c.id), { id: String(c.id), nome: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '', tipo: c.type });
  }
  return [...chat.values()];
}
