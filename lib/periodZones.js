// RANGE — l'intervalle de prix d'une période, période par période.
//
// L'indicateur découpe le TEMPS en fenêtres et peint, pour chacune, l'intervalle
// de PRIX qu'elle a réellement couvert : une boîte [plus bas, plus haut] des
// bougies de la fenêtre. Deux façons de découper, un seul rendu :
//
//   · 'cycle' — on MARQUE pendant X, on ESQUIVE pendant Y, en boucle depuis une
//               heure d'ancrage. Ex. 4 h marquées, les 4 h suivantes ignorées.
//   · 'plage' — une PLAGE HORAIRE par jour (ex. 18:00 → 23:00) ; tout le reste
//               de la journée est esquivé. La plage a le droit de passer minuit
//               (22:00 → 03:00 se lit comme une seule fenêtre à cheval).
//
// LES TEMPS SONT LUS EN UTC, sans exception : les timestamps MT5 sont naïfs
// (heure serveur du broker) et toute la plateforme les traite ainsi — appliquer
// le fuseau local ferait diverger l'heure affichée de l'heure du découpage
// (cf. lib/format.js).
//
// Une fenêtre marquée qui n'a AUCUNE bougie ne produit aucune zone : les bornes
// des boîtes sont toujours des temps de bougie, jamais des temps d'horloge. Le
// week-end ne fabrique donc pas de boîtes vides, et la primitive n'a jamais à
// convertir un temps absent de l'axe.

const DAY = 86400;

export const RANGE_DEFAULTS = {
  // 'cycle' = marquage/esquive en boucle | 'plage' = une plage horaire par jour
  periodMode: 'cycle',

  // ── mode 'cycle' ────────────────────────────────────────────────────────────
  stepUnit:   'h',   // 'h' | 'm' — unité de markLen et skipLen
  markLen:    4,     // durée MARQUÉE
  skipLen:    4,     // durée ESQUIVÉE qui suit (0 = aucune esquive, cycles collés)
  anchorHour: 0,     // heure UTC où démarre le premier cycle de la journée
  // Le cycle repart de l'heure d'ancrage à chaque journée. Sans ça, un cycle qui
  // ne divise pas 24 h (5 h + 2 h) dérive : les fenêtres ne tombent plus jamais
  // aux mêmes heures d'un jour à l'autre. Avec, le dernier cycle de la journée
  // est simplement tronqué à minuit d'ancrage.
  resetDaily: true,

  // ── mode 'plage' ────────────────────────────────────────────────────────────
  fromHour: 18, fromMin: 0,
  toHour:   23, toMin:   0,

  // ── ce qu'on mesure et ce qu'on montre ──────────────────────────────────────
  basis:       'wick',   // 'wick' = mèches comprises | 'body' = corps seuls
  extend:      'none',   // 'none' = la boîte s'arrête avec le marquage
                         // 'cover' = elle se prolonge sur l'esquive, jusqu'au
                         //           marquage suivant (la zone reste sous les yeux)
  // L'esquive encadrée : elle reçoit SA PROPRE boîte, son intervalle à elle,
  // en pointillés et dans sa couleur. On voit alors les deux moitiés du cycle —
  // ce qui a été marqué, et ce que le marché a fait pendant qu'on ne marquait pas.
  frameSkip:   true,
  showMid:     true,     // trait à 50 % de l'intervalle (fenêtres marquées)
  showLabel:   true,     // étiquette « 18:00–23:00 »
  zoneOpacity: 12,       // remplissage, en % (0 = boîte vide, bordures seules)
  dirColor:    false,    // colorer selon le sens de la fenêtre (clôture vs ouverture)
  skipColor:   '#94A3B8',// couleur du cadre d'esquive (jamais celle du marquage)
  maxZones:    200,      // seules les N dernières zones sont dessinées
};

// ── Découpage du temps ───────────────────────────────────────────────────────

function stepSec(len, unit) {
  return Math.max(0, Math.round(len)) * (unit === 'm' ? 60 : 3600);
}

// Le CRÉNEAU qui contient `t` — marqué ou esquivé —, ou null si le réglage ne
// découpe rien (plage de durée nulle).
//
//   { marked, start, end, nextStart }
//
// Les bornes sont celles de l'HORLOGE, pas des bougies : c'est ce qui identifie
// le créneau (`start` sert de clé), ce qui nomme son étiquette, et ce qui borne
// la prolongation d'une zone marquée. `nextStart` est le début du marquage
// SUIVANT — donc la fin de l'esquive.
export function slotAt(t, o) {
  if (o.periodMode === 'plage') {
    const from = (o.fromHour ?? 0) * 3600 + (o.fromMin ?? 0) * 60;
    const to   = (o.toHour   ?? 0) * 3600 + (o.toMin   ?? 0) * 60;
    // Durée marquée, minuit franchi compris : 22:00 → 03:00 dure 5 h.
    const dur = (((to - from) % DAY) + DAY) % DAY;
    if (dur === 0) return null;                 // plage vide : rien à marquer

    // Début du dernier marquage commencé avant `t` — la veille si on est encore
    // avant l'heure de départ du jour courant.
    const dayStart = Math.floor(t / DAY) * DAY;
    let start = dayStart + from;
    if (t < start) start -= DAY;

    if (t - start < dur) {
      return { marked: true, start, end: start + dur, nextStart: start + DAY };
    }
    return { marked: false, start: start + dur, end: start + DAY, nextStart: start + DAY };
  }

  // ── mode 'cycle' ────────────────────────────────────────────────────────────
  const markSec = stepSec(o.markLen ?? 4, o.stepUnit ?? 'h');
  if (markSec <= 0) return null;
  const skipSec  = stepSec(o.skipLen ?? 4, o.stepUnit ?? 'h');
  const cycleSec = markSec + skipSec;
  const anchor   = ((o.anchorHour ?? 0) % 24) * 3600;

  if (o.resetDaily === false) {
    // Cycles continus depuis l'époque décalée de l'ancrage. L'époque Unix tombe
    // à minuit UTC : tant que le cycle divise 24 h, les fenêtres restent calées
    // sur les mêmes heures d'un jour à l'autre.
    const start = anchor + Math.floor((t - anchor) / cycleSec) * cycleSec;
    if (t - start < markSec) {
      return { marked: true, start, end: start + markSec, nextStart: start + cycleSec };
    }
    return { marked: false, start: start + markSec, end: start + cycleSec, nextStart: start + cycleSec };
  }

  // Journée d'ancrage : elle commence à `anchorHour` et dure 24 h. Le dernier
  // cycle de la journée est tronqué à minuit d'ancrage, marquage compris.
  const dayStart = Math.floor((t - anchor) / DAY) * DAY + anchor;
  const dayEnd   = dayStart + DAY;
  const start    = dayStart + Math.floor((t - dayStart) / cycleSec) * cycleSec;
  const markEnd  = Math.min(start + markSec, dayEnd);
  const cycleEnd = Math.min(start + cycleSec, dayEnd);
  if (t < markEnd) {
    return { marked: true, start, end: markEnd, nextStart: cycleEnd };
  }
  return { marked: false, start: markEnd, end: cycleEnd, nextStart: cycleEnd };
}

// La fenêtre MARQUÉE qui contient `t`, ou null si `t` tombe dans une esquive.
export function windowAt(t, o) {
  const s = slotAt(t, o);
  return s?.marked ? s : null;
}

// ── Zones ────────────────────────────────────────────────────────────────────

// Retourne { zones }, chaque zone étant une boîte prête à peindre :
//   { marked, start, end, top, bottom, mid, side,
//     startTime, endTime, extendTime, live, label }
// `startTime`/`endTime` sont des TEMPS DE BOUGIE (bords de la boîte),
// `start`/`end` les temps d'horloge du créneau (étiquette et diagnostic).
// `marked` distingue la fenêtre marquée du créneau esquivé encadré.
export function calcRangeZones(candles, ind = {}) {
  const o = { ...RANGE_DEFAULTS, ...ind };
  if (!candles?.length) return { zones: [] };

  const body  = o.basis === 'body';
  const frame = o.frameSkip !== false;
  const zones = [];
  let cur = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const s = slotAt(c.time, o);
    // Esquive non encadrée : la bougie n'appartient à aucune boîte.
    if (!s || (!s.marked && !frame)) { cur = null; continue; }

    if (!cur || cur.start !== s.start || cur.marked !== s.marked) {
      cur = {
        marked: s.marked,
        start: s.start, end: s.end, nextStart: s.nextStart,
        top: -Infinity, bottom: Infinity,
        firstOpen: c.open, lastClose: c.close,
        startIdx: i, endIdx: i,
        startTime: c.time, endTime: c.time,
      };
      zones.push(cur);
    }

    const hi = body ? Math.max(c.open, c.close) : c.high;
    const lo = body ? Math.min(c.open, c.close) : c.low;
    if (hi > cur.top)    cur.top    = hi;
    if (lo < cur.bottom) cur.bottom = lo;
    cur.lastClose = c.close;
    cur.endIdx    = i;
    cur.endTime   = c.time;
  }

  const last  = candles.length - 1;
  const cover = o.extend === 'cover';

  for (let z = 0; z < zones.length; z++) {
    const zone = zones[z];
    zone.mid  = (zone.top + zone.bottom) / 2;
    zone.side = zone.lastClose >= zone.firstOpen ? 'bull' : 'bear';
    // Une zone n'est « en cours » que si la dernière bougie chargée lui
    // appartient : rien ne dit alors que son intervalle est définitif.
    zone.live = zone.endIdx === last;
    zone.label = `${hm(zone.start)}–${hm(zone.end)}`;

    zone.extendTime = null;
    if (cover && zone.marked) {
      // La prolongation court jusqu'au marquage suivant, et pas au-delà : on
      // s'arrête à la dernière bougie qui précède `nextStart`, quitte à ce que
      // ce soit la dernière bougie chargée. La boîte d'esquive éventuelle n'est
      // pas une borne — les deux se superposent, chacune disant sa chose.
      let stop = candles.length;
      for (let n = z + 1; n < zones.length; n++) {
        if (zones[n].marked) { stop = zones[n].startIdx; break; }
      }
      let j = zone.endIdx;
      while (j + 1 < stop && candles[j + 1].time < zone.nextStart) j++;
      if (j > zone.endIdx) zone.extendTime = candles[j].time;
    }
  }

  const max = Math.max(1, o.maxZones ?? 200);
  return { zones: zones.length > max ? zones.slice(zones.length - max) : zones };
}

function hm(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// Résumé court d'un réglage, pour les listes et les étiquettes de panneau.
export function rangeLabel(ind = {}) {
  const o = { ...RANGE_DEFAULTS, ...ind };
  if (o.periodMode === 'plage') {
    const p = n => String(n).padStart(2, '0');
    return `${p(o.fromHour)}:${p(o.fromMin)}→${p(o.toHour)}:${p(o.toMin)}`;
  }
  const u = o.stepUnit === 'm' ? 'm' : 'h';
  return `${o.markLen}${u}/${o.skipLen}${u}`;
}
