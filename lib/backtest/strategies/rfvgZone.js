// Stratégie sur les zones rFVG / aFVG (détecteur : calcRFVG de lib/patterns.js,
// cf. pines/rFVG.pine).
//
// LECTURE DU MOTIF — une bougie centrale large et directionnelle laisse un gap
// béant entre la bougie qui la précède et celle qui la suit. En mode rFVG elle
// est en plus à contre-courant de son côté de la MM (baissière entièrement
// au-dessus, haussière entièrement en dessous). La zone est le gap lui-même :
//   • zone baissière → zone d'OFFRE, au-dessus du marché  → on VEND
//   • zone haussière → zone de DEMANDE, en dessous        → on ACHÈTE
//
// ANTI-LOOKAHEAD — le motif a besoin de la bougie SUIVANTE pour exister : il
// n'est connu qu'à la clôture de celle-ci. Une zone dont la bougie centrale est
// en `i` n'est donc armée qu'à partir de `i+1`, jamais avant.
//
// ENTRÉE
//   • « retest » (défaut) — on attend que le prix revienne toucher la zone. Le
//     niveau part du bord PROCHE (celui que le prix rencontre en premier) et
//     s'enfonce de `entryAtr` × ATR dans la zone ; négatif = anticipation, avant
//     la zone. Il est borné au bord opposé : une marge plus large que la zone
//     revient à en attendre la traversée complète, jamais à rendre le
//     déclenchement inatteignable.
//     Le bord proche de la zone est, par construction, l'extrême exact de la
//     bougie de confirmation — celle-ci ne peut donc pas déclencher son propre
//     retest (touche triviale par égalité) : la zone n'est testée qu'à partir de
//     la bougie d'après.
//     Le toucher est constaté à la CLÔTURE d'une bougie → entrée au marché à
//     l'open suivant. Le moteur n'ayant pas d'ordre limite d'entrée, le fill peut
//     être moins bon que le niveau visé — c'est assumé et honnête (jamais
//     meilleur).
//   • « immediate » — entrée au marché dès la bougie de confirmation.
//
// SORTIES — SL et TP fixes, exprimés en points ou en multiples d'ATR selon
// `stopMode`, en distance depuis le prix d'entrée RÉEL (pas depuis le close du
// signal). Break-even optionnel, réglé en fraction du risque initial : quand le
// prix a parcouru `beTriggerR` × R en notre faveur, le SL revient au prix
// d'entrée exactement — sans offset, un stop posé au-delà du prix courant serait
// un stop du mauvais côté du marché.

import { calcRFVG } from '../../patterns';
import { atrArr } from '../ta';

export default {
  id:    'rfvg-zone',
  label: 'rFVG — zones',
  desc:  'Vend les zones rFVG baissières, achète les haussières : au retest de la zone (marge ATR) ou dès la détection. SL/TP fixes, break-even optionnel.',

  params: [
    // — Détection (mêmes réglages que l'indicateur rFVG)
    { key: 'mode',        label: 'Motifs retenus',            type: 'select', def: 'rfvg',  options: ['rfvg', 'all'], hint: 'rfvg = centrale à contre-courant de la MM ; all = tout motif de base (aFVG, rFVG inclus)' },
    { key: 'direction',   label: 'Direction',                 type: 'select', def: 'both',  options: ['both', 'bull', 'bear'] },
    { key: 'maPeriod',    label: 'MM — période',              type: 'int',    def: 50,  min: 2,  max: 400 },
    { key: 'sizeMode',    label: 'Mesure de la centrale',     type: 'select', def: 'range', options: ['range', 'body'], hint: 'range = amplitude haut-bas ; body = |clôture-ouverture|' },
    { key: 'atrPeriod',   label: 'ATR — période',             type: 'int',    def: 14,  min: 1,  max: 100, hint: 'sert au filtre de taille, à la marge d’entrée et aux stops en mode ATR' },
    { key: 'atrMult',     label: 'Centrale ≥ ATR ×',          type: 'float',  def: 1.5, min: 0,  max: 10,  step: 0.1, hint: '0 = filtre de taille désactivé' },
    { key: 'minPts',      label: 'Gap minimum (points)',      type: 'float',  def: 0,   min: 0,  max: 10000, step: 0.1, hint: '0 = tous les gaps' },

    // — Entrée
    { key: 'entryMode',   label: 'Entrée',                    type: 'select', def: 'retest', options: ['retest', 'immediate'], hint: 'retest = retour du prix dans la zone ; immediate = dès la confirmation' },
    { key: 'entryAtr',    label: 'Marge d’entrée (× ATR)',    type: 'float',  def: 0,   min: -2, max: 5, step: 0.05, hint: 'retest : + = attendre plus profond dans la zone, − = anticiper avant la zone' },
    { key: 'maxWaitBars', label: 'Durée de vie de la zone',   type: 'int',    def: 20,  min: 1,  max: 500, hint: 'bougies pendant lesquelles la zone reste armée après sa confirmation' },

    // — Sorties
    { key: 'stopMode',    label: 'Unité des stops',           type: 'select', def: 'atr', options: ['atr', 'points'] },
    { key: 'slValue',     label: 'SL (× ATR ou points)',      type: 'float',  def: 1.5, min: 0.01, max: 10000, step: 0.1 },
    { key: 'tpValue',     label: 'TP (× ATR ou points)',      type: 'float',  def: 3,   min: 0.01, max: 10000, step: 0.1 },
    { key: 'beTriggerR',  label: 'Break-even (× R initial)',  type: 'float',  def: 0,   min: 0,  max: 10, step: 0.1, hint: '0 = désactivé. Sinon le SL revient au prix d’entrée dès ce gain, mesuré en multiple du risque initial.' },
  ],

  setup(candles, p) {
    const zones = calcRFVG(candles, {
      mode:      p.mode,
      direction: p.direction,
      minPts:    p.minPts,
      maPeriod:  p.maPeriod,
      atrPeriod: p.atrPeriod,
      atrMult:   p.atrMult,
      sizeMode:  p.sizeMode,
    });

    const idxByTime = new Map();
    for (let i = 0; i < candles.length; i++) idxByTime.set(candles[i].time, i);

    // startTime = bougie CENTRALE. Le motif n'est confirmé qu'une bougie plus
    // tard — c'est là, et pas avant, que la zone devient connue du marché.
    const born = new Map(); // index de confirmation → zones nées à cette clôture
    for (const z of zones) {
      const mid = idxByTime.get(z.startTime);
      if (mid == null) continue;
      const at = mid + 1;
      if (at >= candles.length) continue;
      if (!born.has(at)) born.set(at, []);
      born.get(at).push(z);
    }

    return {
      born,
      atr:   atrArr(candles, p.atrPeriod),
      state: { armed: [], beId: null },
    };
  },

  onBar({ candles, i, ind, position, params: p }) {
    const st  = ind.state;
    const bar = candles[i];
    const atr = ind.atr[i];

    // — En position : break-even, et rien d'autre (moteur mono-position).
    if (position) {
      if (p.beTriggerR > 0 && position.risk0 > 0 && st.beId !== position.id) {
        const fav = position.direction === 'BUY'
          ? bar.close - position.entryPrice
          : position.entryPrice - bar.close;
        if (fav >= p.beTriggerR * position.risk0) {
          st.beId = position.id;
          return { action: 'modify', sl: position.entryPrice };
        }
      }
      return null;
    }

    if (atr == null) return null;

    const fresh = ind.born.get(i) ?? null;

    const order = (zone, trigger) => {
      const dist     = v => (p.stopMode === 'points' ? v : v * atr);
      const slPoints = dist(p.slValue);
      const tpPoints = dist(p.tpValue);
      if (!(slPoints > 0)) return null;
      const sens  = zone.side === 'bear' ? 'baissier' : 'haussier';
      return {
        action:   zone.side === 'bear' ? 'sell' : 'buy',
        slPoints, tpPoints,
        reason:   `${zone.label} ${sens} — ${trigger}`,
      };
    };

    // — Entrée immédiate : la zone se joue à sa confirmation, sans attendre.
    if (p.entryMode === 'immediate') {
      if (!fresh || !fresh.length) return null;
      return order(fresh[fresh.length - 1], 'détection');
    }

    // — Entrée au retest : armer les zones nées ici, purger les périmées.
    if (fresh) {
      const margin = p.entryAtr * atr;
      for (const z of fresh) {
        // Le bord PROCHE est celui que le prix rencontre en revenant : le bas
        // d'une zone d'offre (prix en dessous), le haut d'une zone de demande.
        // La marge enfonce le niveau dans la zone, bornée au bord opposé.
        const trigger = z.side === 'bear'
          ? Math.min(z.bottom + margin, z.top)
          : Math.max(z.top - margin, z.bottom);
        st.armed.push({
          side:    z.side,
          label:   z.label,
          trigger,
          from:    i + 1,               // la bougie de confirmation ne se teste pas elle-même
          expires: i + p.maxWaitBars,
        });
      }
    }

    if (!st.armed.length) return null;
    st.armed = st.armed.filter(z => i <= z.expires);

    // Premier toucher, zone la plus récente d'abord.
    for (let k = st.armed.length - 1; k >= 0; k--) {
      const z = st.armed[k];
      if (i < z.from) continue;
      const hit = z.side === 'bear' ? bar.high >= z.trigger : bar.low <= z.trigger;
      if (!hit) continue;
      st.armed.splice(k, 1);           // zone consommée
      return order(z, 'retest');
    }

    return null;
  },
};
