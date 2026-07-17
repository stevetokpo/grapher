// Canal Telegram — Bot API, texte libre, aucun template à faire approuver.
// Bot créé via @BotFather ; chat_id obtenu en écrivant au bot puis en lisant
// https://api.telegram.org/bot<TOKEN>/getUpdates (voir docs/notifications.md).
import { formatSignal } from '../format';

const API = 'https://api.telegram.org';

// MarkdownV2 exige l'échappement de cette liste exacte de caractères.
function esc(s) {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => `\\${c}`);
}

export default {
  id:    'telegram',
  label: 'Telegram',
  desc:  'Message du bot Telegram vers TELEGRAM_CHAT_ID',
  envKeys: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],

  ready() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  },

  async send(signal) {
    const { title, lines } = formatSignal(signal);
    const text = [`*${esc(title)}*`, '', ...lines.map(l => {
      const [k, ...rest] = l.split(' : ');
      return `${esc(k)} : *${esc(rest.join(' : '))}*`;
    })].join('\n');

    const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id:    process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'MarkdownV2',
        disable_notification: false,
      }),
    });

    if (!res.ok) {
      // L'API Telegram renvoie 200 même sur erreur métier ; le vrai statut est
      // dans le corps. On lit les deux pour un message d'erreur exploitable.
      const body = await res.text().catch(() => '');
      throw new Error(`Telegram HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const body = await res.json();
    if (!body.ok) throw new Error(`Telegram: ${body.description ?? 'erreur inconnue'}`);
  },
};
