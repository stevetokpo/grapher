// Pas de temps du ticker — source unique, partagée par la route de lecture
// (pages/api/ticks.js), le hook (hooks/useTicks.js) et la page (/ticker).
//
// Deux natures de pas, et c'est la distinction structurante de tout le module :
//
//   'tick'  — AUCUNE agrégation. Une ligne de la table = un point à l'écran.
//             L'axe du temps ne peut donc pas être un axe de temps : deux ticks
//             peuvent tomber dans la même milliseconde, et lightweight-charts
//             exige des abscisses strictement croissantes en SECONDES. Le
//             graphe indexe donc les points (0, 1, 2, …) et réécrit les
//             étiquettes d'axe depuis l'horodatage réel. C'est aussi ce qui
//             rend la vue lisible : sans ça, 300 ticks dans la même seconde se
//             tasseraient sur une colonne d'un pixel.
//
//   1s … 1m — agrégation en seaux de N secondes, abscisse = vrai epoch.
//
// Tous les N divisent 86 400 : les seaux retombent donc exactement sur minuit,
// quel que soit le pas. C'est ce qui autorise l'arithmétique directe
// floor(epoch/N)*N côté SQL, sans avoir à discuter l'origine de time_bucket.
export const RESOLUTIONS = [
  { id: 'tick', label: 'TICK', sec: 0,  short: 'tick' },
  { id: '1s',   label: '1s',   sec: 1,  short: '1s'   },
  { id: '2s',   label: '2s',   sec: 2,  short: '2s'   },
  { id: '5s',   label: '5s',   sec: 5,  short: '5s'   },
  { id: '10s',  label: '10s',  sec: 10, short: '10s'  },
  { id: '15s',  label: '15s',  sec: 15, short: '15s'  },
  { id: '20s',  label: '20s',  sec: 20, short: '20s'  },
  { id: '30s',  label: '30s',  sec: 30, short: '30s'  },
  { id: '45s',  label: '45s',  sec: 45, short: '45s'  },
  { id: '1m',   label: 'M1',   sec: 60, short: '1m'   },
];

export const RESOLUTION_IDS = RESOLUTIONS.map(r => r.id);

export function getResolution(id) {
  return RESOLUTIONS.find(r => r.id === id) ?? null;
}

export function isTickResolution(id) {
  return id === 'tick';
}

// Sources de prix. `mid` est le milieu bid/ask — c'est la seule source qui ne
// saute pas d'un côté à l'autre du spread, donc la plus honnête pour lire un
// mouvement. `last` n'existe que sur les instruments qui publient des
// transactions : sur les indices synthétiques (V75 & co.), MT5 n'envoie que des
// cotations, la colonne reste vide et la source est proposée grisée.
export const PRICE_SOURCES = [
  { id: 'bid',  label: 'Bid',  col: 'bid' },
  { id: 'ask',  label: 'Ask',  col: 'ask' },
  { id: 'mid',  label: 'Mid',  col: '((bid + ask) / 2.0)' },
  { id: 'last', label: 'Last', col: 'last_price' },
];

export const PRICE_SOURCE_IDS = PRICE_SOURCES.map(s => s.id);

// Expression SQL de la source, ou null si l'id est inconnu (l'appelant refuse).
export function sourceExpr(id) {
  return PRICE_SOURCES.find(s => s.id === id)?.col ?? null;
}

// ── Décimales du symbole ─────────────────────────────────────────────────────
// Le nombre de décimales est LU dans les prix, pas demandé à l'utilisateur.
//
// Il ne peut pas se déduire de la longueur du texte : le prix « mid » est
// calculé — (bid+ask)/2 en virgule flottante — et sort régulièrement en
// 63758.941000000004. Compter ses décimales donnerait 12, et l'échelle
// afficherait « 63815.00000000 » sur un instrument qui en a trois.
//
// On cherche donc le plus PETIT nombre de décimales qui restitue la valeur à la
// précision de la machine près. Le bruit flottant, relatif par nature, disparaît
// avec une tolérance relative ; une vraie décimale, elle, pèse toujours bien
// plus lourd que 1e-10 de la valeur.
const DIGIT_TOL = 1e-10;

export function digitsOf(price) {
  if (!Number.isFinite(price)) return 0;
  const tol = Math.abs(price) * DIGIT_TOL;
  for (let d = 0; d <= 8; d++) {
    if (Math.abs(price - Number(price.toFixed(d))) <= tol) return d;
  }
  return 8;
}

// Décimales d'un échantillon : le maximum, parce qu'un prix rond en tête de
// liste ne doit pas décider pour tout le graphe. Parcours à rebours — les
// dernières lignes sont celles qu'on regarde.
export function inferDigits(values, { sample = 200, fallback = 5 } = {}) {
  let best = 0, seen = 0;
  for (let i = values.length - 1; i >= 0 && seen < sample; i--) {
    const p = values[i];
    if (p == null || !Number.isFinite(p)) continue;
    seen++;
    const d = digitsOf(p);
    if (d > best) best = d;
  }
  if (!seen) return fallback;
  return Math.max(2, best);
}

// ── Horodatage ───────────────────────────────────────────────────────────────
// Les ticks sont stockés en MICROsecondes (voir pages/api/live/ticks.js : la
// microseconde départage deux ticks d'une même milliseconde). Le client
// raisonne, lui, en millisecondes — c'est la précision que MT5 fournit et la
// seule qui ait un sens à l'affichage.
export const US_PER_MS = 1000;

export function usToMs(us) {
  return Math.floor(us / US_PER_MS);
}

// HH:MM:SS.mmm en UTC. Les horodatages MT5 sont naïfs (heure du broker) : on
// n'applique jamais le fuseau local, sinon les heures divergeraient entre le
// ticker et le reste de la plateforme.
export function fmtClockMs(ms, { millis = true } = {}) {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  if (!millis) return `${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`;
}

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export function fmtDateMs(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTimeMs(ms, opts) {
  return `${fmtDateMs(ms)}  ${fmtClockMs(ms, opts)}`;
}
