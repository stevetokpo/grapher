// Registre des canaux de notification.
// Pour ajouter un canal (WhatsApp Cloud API, Discord, SMS…) : créer le fichier
// ici, l'importer, l'ajouter à CHANNELS — rien d'autre. L'UI des alertes et la
// validation de l'API se génèrent depuis ce registre (même motif que
// lib/backtest/strategies/index.js).
//
// Contrat d'un canal :
//   id       string unique, kebab-case
//   label    nom affiché
//   desc     une phrase
//   envKeys  variables d'environnement attendues (affichées dans l'UI si absentes)
//   ready()  → bool : la config est-elle complète ?
//   send(signal) → Promise, throw en cas d'échec (le dispatcher journalise)
//
// `signal` est l'objet produit par lib/notify/evaluate.js :
//   { alertId, alertName, symbol, tf, strategyLabel, signal:'buy'|'sell',
//     action, price, sl, tp, reason, candleTs }

import email    from './email';
import telegram from './telegram';
import push     from './push';

export const CHANNELS = [telegram, email, push];

export function getChannel(id) {
  return CHANNELS.find(c => c.id === id) ?? null;
}

// Description sérialisable pour l'UI (une fonction ne traverse pas JSON).
export function describeChannels() {
  return CHANNELS.map(({ id, label, desc, envKeys }) => ({
    id, label, desc, envKeys,
    ready:   getChannel(id).ready(),
    missing: envKeys.filter(k => !process.env[k]),
  }));
}

// Ne garde que des ids de canaux connus (et dédoublonne).
export function sanitizeChannels(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(id => getChannel(id)))];
}
