// Stratégie fondée sur l'indicateur EQ — Point d'équilibre (lib/equilibrium.js).
//
// L'EQ reconstruit l'enchère des `lookback` dernières bougies, en extrait le prix
// d'équilibre (le mode du profil de volume), la value area autour, et note 0-100
// si le marché y est réellement en équilibre — le score étant calibré pour que 70
// corresponde au ~95e centile d'une marche aléatoire (cf. docs/equilibrium.md).
//
// Trois thèses classiques de la théorie des enchères, exclusives (`mode`) :
//
//   revert    En balance confirmée, le prix qui atteint le bord de la valeur est
//             en train d'être refusé : on vend le bord haut, on achète le bord
//             bas, et on vise le point. C'est le trade canonique de l'équilibre.
//             Fenêtre d'entrée : au-delà du bord de la VA mais PAS encore accepté
//             au-delà (sinon ce n'est plus un rejet, c'est une cassure).
//
//   breakout  Le prix est accepté hors de la valeur et le marché cesse de noter
//             comme un équilibre : la balance meurt, le marché initie. On entre
//             dans le sens de la cassure, à la bougie où elle est confirmée.
//
//   failed    Après une cassure, le prix revient à l'intérieur de la value area
//             dans les `failMaxBars` bougies : la cassure a échoué. On entre
//             CONTRE elle, vers le point. (« look above and fail ».)
//
// Unité de risque : la LARGEUR DE LA VALUE AREA de la zone, pas des points fixes.
// L'enchère fournit sa propre échelle — un stop de 1 vaW veut dire la même chose
// sur XAUUSD et sur BTCUSD, et la stratégie se transpose sans recalibrage.
//
// Anti-lookahead : tout passe par eqPerBar(), qui aplatit la machine à états en
// tableaux ne contenant, à l'indice i, que ce qui était connaissable à la clôture
// de la bougie i. La zone est figée à sa reconnaissance ; ses champs de fin
// (endIdx, breakIdx, score courant) ne sont jamais lus ici.

import { eqPerBar } from '../../equilibrium';

export default {
  id:    'eq-balance',
  label: 'EQ — Équilibre (fade / cassure / retour)',
  desc:  'Trade la balance détectée par le point d\'équilibre : fade du bord de la valeur vers le point, cassure de la balance, ou retour dans la valeur après une cassure échouée',

  params: [
    { key: 'mode', label: 'Thèse', type: 'select', def: 'revert',
      options: ['revert', 'breakout', 'failed'],
      hint: 'revert = fade du bord de la valeur vers le point · breakout = sens de la cassure · failed = contre une cassure qui revient dans la valeur' },
    { key: 'direction', label: 'Direction', type: 'select', def: 'both', options: ['both', 'long', 'short'] },
    { key: 'invertSig', label: 'Inverser les signaux (contrôle)', type: 'bool', def: false,
      hint: 'Contrôle de diagnostic, pas un réglage. Un edge directionnel réel doit devenir SYMÉTRIQUEMENT négatif une fois inversé. S\'il reste positif dans les deux sens, le résultat ne vient pas du signal mais de la géométrie SL/TP.' },

    // ── Détection de l'équilibre (paramètres de l'indicateur EQ) ──
    { key: 'lookback',  label: 'EQ — fenêtre d\'enchère (bougies)', type: 'int', def: 60, min: 20, max: 400 },
    { key: 'threshold', label: 'EQ — seuil d\'équilibre (ouvre la zone)', type: 'int', def: 70, min: 40, max: 95,
      hint: '70 ≈ 95e centile du bruit : ~5% de faux positifs par construction.' },
    { key: 'entryScore', label: 'EQ — score minimum exigé', type: 'int', def: 70, min: 0, max: 95,
      hint: 'revert : le marché doit noter comme un équilibre AU MOMENT d\'entrer (la zone survit à une baisse du score). breakout/failed : le score à la cassure est bas par construction, donc le filtre porte sur la QUALITÉ DE LA BALANCE qui vient d\'être cassée (score à sa reconnaissance). 0 = pas de filtre.' },
    { key: 'valueArea',   label: 'EQ — value area (%)', type: 'int',   def: 70,   min: 50,  max: 90 },
    { key: 'confirmBars', label: 'EQ — clôtures pour casser', type: 'int', def: 2, min: 1, max: 10 },
    { key: 'breakBuffer', label: 'EQ — marge de cassure (× largeur VA)', type: 'float', def: 0.25, min: 0, max: 2, step: 0.05 },

    // ── Risque, en largeurs de value area ──
    { key: 'slMult', label: 'Stop Loss (× largeur VA)', type: 'float', def: 1, min: 0.2, max: 5, step: 0.1 },
    { key: 'tpMode', label: 'Objectif', type: 'select', def: 'rr', options: ['rr', 'point'],
      hint: 'rr = multiple du risque · point = le point d\'équilibre lui-même (n\'a de sens que pour revert et failed).' },
    { key: 'tpRR',   label: 'Take Profit (multiple de R)', type: 'float', def: 1.5, min: 0.2, max: 10, step: 0.1 },

    { key: 'failMaxBars', label: 'failed — délai de retour dans la valeur (bougies)', type: 'int', def: 20, min: 1, max: 200 },
  ],

  setup(candles, p) {
    const eq = eqPerBar(candles, {
      lookback:    p.lookback,
      threshold:   p.threshold,
      valueArea:   p.valueArea,
      confirmBars: p.confirmBars,
      breakBuffer: p.breakBuffer,
    });
    return {
      ...eq,
      // état séquentiel muté par onBar (appelé dans l'ordre des bougies)
      state: {
        taken:   new Map(), // anchorIdx → { long: bool, short: bool } : une entrée max par sens et par zone
        pending: null,      // cassure en attente d'un retour dans la valeur (mode failed)
      },
    };
  },

  onBar({ candles, i, ind, position, params: p }) {
    const st = ind.state;
    const c  = candles[i];

    // ── mode failed : armer / entretenir la cassure en attente de retour ──────
    if (p.mode === 'failed') {
      const side = ind.brk[i];
      if (side) {
        const z = ind.zone[i];
        st.pending = { z, side, at: i };
      } else if (st.pending && i - st.pending.at >= p.failMaxBars) {
        st.pending = null; // le prix n'est jamais revenu : la cassure a tenu
      }
    }

    if (position) return null;

    const emit = (rawDir, z, target) => {
      const vaW = z.vah - z.val;
      if (!(vaW > 0)) return null;

      // Contrôle : le même signal, joué à l'envers. Le filtre `direction`
      // s'applique APRÈS l'inversion, sinon le contrôle ne serait pas symétrique.
      const dir = p.invertSig ? (rawDir === 'buy' ? 'sell' : 'buy') : rawDir;
      if (dir === 'buy'  && p.direction === 'short') return null;
      if (dir === 'sell' && p.direction === 'long')  return null;

      const sign     = dir === 'buy' ? 1 : -1;
      const slPoints = p.slMult * vaW;

      let tp;
      if (p.tpMode === 'point') {
        tp = target;
        // Un objectif du mauvais côté de l'entrée (ou collé dessus) n'est pas un
        // trade : le point est déjà derrière nous.
        if (!(sign * (tp - c.close) > 0.1 * vaW)) return null;
      } else {
        tp = undefined; // distance : résolue par le moteur depuis l'entrée réelle
      }

      const taken = st.taken.get(z.anchorIdx) ?? { buy: false, sell: false };
      if (taken[dir]) return null;           // une entrée max par sens et par zone
      taken[dir] = true;
      st.taken.set(z.anchorIdx, taken);

      return {
        action:   dir,
        slPoints,
        ...(p.tpMode === 'point' ? { tp } : { tpPoints: slPoints * p.tpRR }),
        reason:   `${p.mode} · score ${Math.round(ind.score[i] ?? 0)}`,
      };
    };

    // ── revert : le bord de la valeur est refusé, on vise le point ────────────
    if (p.mode === 'revert') {
      const z = ind.zone[i];
      // Pas de fade sur la bougie où la balance meurt : à cette clôture on SAIT
      // que la valeur a été acceptée — ce n'est plus un rejet, c'est une cassure.
      if (!z || ind.brk[i]) return null;
      if ((ind.score[i] ?? 0) < p.entryScore) return null;

      const vaW  = z.vah - z.val;
      const up   = z.vah + p.breakBuffer * vaW; // au-delà = accepté = cassure
      const dn   = z.val - p.breakBuffer * vaW;

      // Au-delà du bord de la valeur, mais pas encore accepté au-delà.
      if (c.close >= z.vah && c.close <= up) return emit('sell', z, z.poc);
      if (c.close <= z.val && c.close >= dn) return emit('buy',  z, z.poc);
      return null;
    }

    // La qualité d'une balance qui vient de casser se lit à sa RECONNAISSANCE :
    // au moment de la cassure le score est effondré par construction (c'est la
    // condition de mort de la zone), le filtrer là n'aurait aucun sens.
    const zoneQuality = z => ind.score[z.anchorIdx] ?? 0;

    // ── breakout : la valeur est refusée, le marché initie ────────────────────
    if (p.mode === 'breakout') {
      const side = ind.brk[i];
      if (!side) return null;
      const z = ind.zone[i];
      if (!z || zoneQuality(z) < p.entryScore) return null;
      if (side === 'up')   return emit('buy',  z, null);
      if (side === 'down') return emit('sell', z, null);
      return null;
    }

    // ── failed : la cassure revient dans la valeur ────────────────────────────
    if (p.mode === 'failed') {
      const pend = st.pending;
      if (!pend || pend.at === i) return null;   // pas d'entrée sur la bougie de cassure
      const z = pend.z;
      if (zoneQuality(z) < p.entryScore) return null;
      const back = c.close >= z.val && c.close <= z.vah; // revenu DANS la valeur
      if (!back) return null;

      st.pending = null;
      if (pend.side === 'up')   return emit('sell', z, z.poc);
      if (pend.side === 'down') return emit('buy',  z, z.poc);
      return null;
    }

    return null;
  },
};
