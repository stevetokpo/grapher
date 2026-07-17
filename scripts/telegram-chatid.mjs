#!/usr/bin/env node
// Récupère le chat_id Telegram en attendant que tu écrives au bot.
//
//   node scripts/telegram-chatid.mjs [token]
//
// Sans argument, le token est lu dans .env.local (TELEGRAM_BOT_TOKEN).
// Le script reste en long-polling jusqu'à ton premier message, affiche le
// chat_id, l'écrit dans .env.local, puis te répond dans Telegram pour confirmer.
// Aucune dépendance : fetch natif (Node 18+).

import fs   from 'fs';
import path from 'path';

const ENV_FILE = path.join(process.cwd(), '.env.local');
const API      = 'https://api.telegram.org';

// ── .env.local ────────────────────────────────────────────────────────────
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// Remplace la ligne KEY=… si elle existe, l'ajoute sinon. Le reste du fichier
// (tes autres clés, tes commentaires) n'est jamais touché.
function writeEnvKey(key, value) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');

  if (re.test(text)) text = text.replace(re, `${key}=${value}`);
  else               text = text.replace(/\n*$/, '\n') + `${key}=${value}\n`;

  fs.writeFileSync(ENV_FILE, text);
}

// ── API Telegram ──────────────────────────────────────────────────────────
async function tg(token, method, params) {
  const url = new URL(`${API}/bot${token}/${method}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res  = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`${method} : ${body.description ?? `HTTP ${res.status}`}`);
  return body.result;
}

// ── Programme ─────────────────────────────────────────────────────────────
const env   = readEnv();
const token = process.argv[2] ?? env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(`
Aucun token.

  1. Ouvre Telegram, écris à @BotFather, envoie /newbot et suis les étapes.
  2. Relance avec le token :

       node scripts/telegram-chatid.mjs 123456:ABC-DEF...

     ou colle-le dans .env.local (TELEGRAM_BOT_TOKEN=…) puis relance sans argument.
`);
  process.exit(1);
}

let me;
try {
  me = await tg(token, 'getMe');
} catch (err) {
  console.error(`\nToken refusé par Telegram — ${err.message}\n`);
  process.exit(1);
}

console.log(`\nBot : ${me.first_name} (@${me.username})`);
console.log(`\n→ Ouvre https://t.me/${me.username} et envoie n'importe quel message (« salut » suffit).`);
console.log('  J\'attends…  (Ctrl-C pour abandonner)\n');

// On repart du dernier update pour ignorer d'éventuels messages déjà en file.
let offset = 0;
try {
  const backlog = await tg(token, 'getUpdates', { timeout: 0 });
  if (backlog.length) offset = backlog[backlog.length - 1].update_id + 1;
} catch { /* file vide */ }

// Long-polling : la requête reste ouverte jusqu'à 50 s côté Telegram, donc on
// n'interroge pas en boucle serrée — on attend, tout simplement.
while (true) {
  let updates;
  try {
    updates = await tg(token, 'getUpdates', { offset, timeout: 50 });
  } catch (err) {
    console.error(`  (erreur réseau : ${err.message} — nouvelle tentative dans 3 s)`);
    await new Promise(r => setTimeout(r, 3000));
    continue;
  }

  for (const u of updates) {
    offset = u.update_id + 1;
    const msg = u.message ?? u.channel_post;
    if (!msg?.chat) continue;

    const { id, first_name, username, title, type } = msg.chat;
    const who = title ?? [first_name, username && `@${username}`].filter(Boolean).join(' ');

    console.log('─'.repeat(52));
    console.log(`  chat_id : ${id}`);
    console.log(`  de      : ${who} (${type})`);
    console.log(`  message : ${msg.text ?? '(sans texte)'}`);
    console.log('─'.repeat(52));

    writeEnvKey('TELEGRAM_BOT_TOKEN', token);
    writeEnvKey('TELEGRAM_CHAT_ID', String(id));
    console.log('\n.env.local mis à jour (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).');

    await tg(token, 'sendMessage', {
      chat_id: id,
      text: `Grapher est connecté. chat_id = ${id}\nLes alertes arriveront ici.`,
    }).catch(() => {});

    console.log('Message de confirmation envoyé dans Telegram.');
    console.log('\nRedémarre le serveur (npm run dev) pour que la nouvelle config soit lue.\n');
    process.exit(0);
  }
}
