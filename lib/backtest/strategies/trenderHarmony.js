// Portage de pines/trender-strategy.pine — « Harmonie Multi-HTF » (TRENDER).
//
// Biais par HTF : sur chaque unité de temps supérieure, Bollinger(bbLen,
// bbMult) sur les closes HTF → tendance 1 (close > basis+dev), -1 (< basis-dev),
// 0 (neutre). NON-REPAINT comme le Pine (lookahead_on + [1]) : chaque bougie
// chart lit la tendance de la DERNIÈRE bougie HTF CLÔTURÉE.
//
// Harmonie STRICTE = tous les HTF actifs alignés. Entrée LONG au début d'une
// zone haussière, SHORT au début d'une zone baissière (inversable). SL/TP en
// points FIXES depuis le prix d'entrée réel (slPoints/tpPoints du moteur).
//
// Options portées du Pine :
//   • Filtre confirmateur — ne trader que les zones confirmées par un HTF
//     donné (celui dont la tendance a basculé sur la bougie de détection).
//   • Break-even — au seuil de gain atteint (high/low de la bougie), SL déplacé
//     à entrée ± décalage (jamais abaissé), effectif à la bougie suivante.
//   • Revenger — après un SL perdant sur un trade normal : ordre stop de
//     ré-entrée au prix d'entrée d'origine, SL = ancien niveau, TP = R:R ×
//     distance du SL. Annulé si la zone d'harmonie d'origine disparaît, après
//     rvMaxBars bougies, ou si un nouveau signal arrive. Une seule tentative
//     par SL ; une sortie au break-even ne déclenche pas de revanche.

import { HTF_SECONDS, HTF_OFFSET, htfTrendPerBar } from '../../htf';

export default {
  id:    'trender-harmony',
  label: 'Trender — Harmonie Multi-HTF',
  desc:  'Entrée au début d\'une zone d\'harmonie (tous les HTF alignés via Bollinger), SL/TP fixes en points, options break-even et Revenger',

  params: [
    { key: 'useHtf1', label: 'HTF 1 actif', type: 'bool',   def: true },
    { key: 'htf1',    label: 'HTF 1',       type: 'select', def: 'H1',  options: Object.keys(HTF_SECONDS) },
    { key: 'useHtf2', label: 'HTF 2 actif', type: 'bool',   def: true },
    { key: 'htf2',    label: 'HTF 2',       type: 'select', def: 'H4',  options: Object.keys(HTF_SECONDS) },
    { key: 'useHtf3', label: 'HTF 3 actif', type: 'bool',   def: true },
    { key: 'htf3',    label: 'HTF 3',       type: 'select', def: 'H16', options: Object.keys(HTF_SECONDS) },
    { key: 'bbLen',   label: 'Bollinger — période',    type: 'int',   def: 50,    min: 1,    max: 500 },
    { key: 'bbMult',  label: 'Bollinger — écart-type', type: 'float', def: 0.369, min: 0.01, max: 5, step: 0.001 },
    { key: 'direction', label: 'Direction', type: 'select', def: 'both', options: ['both', 'long', 'short'] },
    { key: 'invertSig', label: 'Inverser les signaux (contre-tendance)', type: 'bool', def: false,
      hint: 'Par défaut : harmonie haussière → LONG. Inversé : harmonie haussière → SHORT.' },
    { key: 'slPoints', label: 'Stop Loss (points, 0 = off)',   type: 'float', def: 50,  min: 0, max: 10000000, step: 1 },
    { key: 'tpPoints', label: 'Take Profit (points, 0 = off)', type: 'float', def: 100, min: 0, max: 10000000, step: 1 },
    { key: 'confFlt', label: 'Filtre — zones confirmées par', type: 'select', def: 'toutes',
      options: ['toutes', 'HTF 1', 'HTF 2', 'HTF 3'],
      hint: 'Le HTF confirmateur est celui qui a basculé sur la bougie de détection (les autres étaient déjà alignés).' },
    { key: 'beOn',      label: 'Break-even',                    type: 'bool',  def: false },
    { key: 'beTrigger', label: 'BE — déclenchement (points)',   type: 'float', def: 50, min: 1, max: 10000000, step: 1 },
    { key: 'beOffset',  label: 'BE — décalage (points)',        type: 'float', def: 0,  min: -10000000, max: 10000000, step: 1,
      hint: 'SL déplacé à : entrée + décalage (long) / entrée − décalage (short). Positif = sécurise un petit gain.' },
    { key: 'rvOn',      label: 'Revenger',                      type: 'bool',  def: false,
      hint: 'Après un SL : ré-entrée stop au prix d\'entrée d\'origine si la zone d\'harmonie est toujours active. Nécessite un SL > 0.' },
    { key: 'rvRR',      label: 'Revenger — objectif (R:R)',     type: 'float', def: 1,  min: 0.1, max: 20, step: 0.1 },
    { key: 'rvMaxBars', label: 'Revenger — expiration (bougies, 0 = jamais)', type: 'int', def: 60, min: 0, max: 10000 },
  ],

  setup(candles, p) {
    const n = candles.length;
    const trendFor = key =>
      htfTrendPerBar(candles, HTF_SECONDS[key], HTF_OFFSET[key] ?? 0, p.bbLen, p.bbMult);
    const t1 = p.useHtf1 ? trendFor(p.htf1) : null;
    const t2 = p.useHtf2 ? trendFor(p.htf2) : null;
    const t3 = p.useHtf3 ? trendFor(p.htf3) : null;
    const trends = [t1, t2, t3];
    const active = trends.filter(Boolean).length;

    const longSignal   = new Array(n).fill(false);
    const shortSignal  = new Array(n).fill(false);
    const harmonyLong  = new Array(n).fill(false); // zone soutenant un LONG (invert inclus)
    const harmonyShort = new Array(n).fill(false);

    let prevBull = false, prevBear = false;
    for (let i = 0; i < n; i++) {
      let score = 0;
      for (const t of trends) if (t) score += t[i];

      const bull = active > 0 && score === active;
      const bear = active > 0 && score === -active;
      const startBull = bull && !prevBull;
      const startBear = bear && !prevBear;

      // Filtre confirmateur : le HTF choisi doit avoir basculé sur cette bougie
      let vis = true;
      if ((startBull || startBear) && p.confFlt !== 'toutes') {
        const idx = p.confFlt === 'HTF 1' ? 0 : p.confFlt === 'HTF 2' ? 1 : 2;
        const t = trends[idx];
        vis = Boolean(t) && i > 0 && t[i] !== t[i - 1];
      }

      longSignal[i]   = (p.invertSig ? startBear : startBull) && vis;
      shortSignal[i]  = (p.invertSig ? startBull : startBear) && vis;
      harmonyLong[i]  = p.invertSig ? bear : bull;
      harmonyShort[i] = p.invertSig ? bull : bear;

      prevBull = bull;
      prevBear = bear;
    }

    return {
      longSignal, shortSignal, harmonyLong, harmonyShort,
      // état séquentiel muté par onBar (appelé dans l'ordre des bougies)
      state: { seenTradeId: 0, beAppliedId: null, rv: null },
    };
  },

  onBar({ candles, i, ind, position, params: p, lastTrade }) {
    const st = ind.state;

    // ── Détection revanche : un trade normal vient-il de sortir en SL perdant ?
    if (lastTrade && lastTrade.id !== st.seenTradeId) {
      st.seenTradeId = lastTrade.id;
      if ((lastTrade.reason ?? '').startsWith('revanche')) {
        // La revanche a été jouée (même ouverte ET fermée dans la même bougie) →
        // consommée. NB : le Pine d'origine ne couvre pas ce cas intra-bougie
        // (rvOpen jamais observé vrai à une clôture) et ré-armait en boucle —
        // on applique ici son intention déclarée : une seule tentative par SL.
        st.rv = null;
      } else if (p.rvOn && p.slPoints > 0) {
        const t = lastTrade;
        const isLong = t.direction === 'BUY';
        const realLoss = t.exitReason === 'sl'
          && (isLong ? t.exitPrice < t.entryPrice : t.exitPrice > t.entryPrice)
          && st.beAppliedId !== t.id; // sortie au break-even exclue
        if (realLoss) {
          st.rv = {
            dir:      isLong ? 1 : -1,
            entryLvl: t.entryPrice,
            stopLvl:  isLong ? t.entryPrice - p.slPoints : t.entryPrice + p.slPoints,
            tpLvl:    isLong ? t.entryPrice + p.slPoints * p.rvRR
                             : t.entryPrice - p.slPoints * p.rvRR,
            setBar:   i,
          };
        }
      }
    }

    // La revanche vient d'être exécutée → plus d'ordre en attente
    if (position && st.rv && (position.reason ?? '').startsWith('revanche')) st.rv = null;

    // Maintien : la zone d'harmonie d'origine doit toujours être active + expiration
    if (st.rv) {
      const zoneOk = st.rv.dir === 1 ? ind.harmonyLong[i] : ind.harmonyShort[i];
      if (!zoneOk) st.rv = null;
      else if (p.rvMaxBars > 0 && i - st.rv.setBar >= p.rvMaxBars) st.rv = null;
    }

    // ── Signaux d'entrée (un nouveau signal annule toute revanche en attente)
    const long  = ind.longSignal[i]  && p.direction !== 'short';
    const short = ind.shortSignal[i] && p.direction !== 'long';
    if (long || short) {
      st.rv = null;
      const wanted = long ? 'BUY' : 'SELL';
      if (!position || position.direction !== wanted) {
        return {
          action:   long ? 'buy' : 'sell',
          slPoints: p.slPoints > 0 ? p.slPoints : undefined,
          tpPoints: p.tpPoints > 0 ? p.tpPoints : undefined,
          reason:   long ? 'harmonie haussière' : 'harmonie baissière',
        };
      }
      // même sens qu'une position ouverte → entrée ignorée, on continue (break-even…)
    }

    // ── Break-even : seuil de gain atteint → SL à entrée ± décalage (jamais abaissé)
    if (p.beOn && position && st.beAppliedId !== position.id) {
      const isL = position.direction === 'BUY';
      const hit = isL
        ? candles[i].high >= position.entryPrice + p.beTrigger
        : candles[i].low  <= position.entryPrice - p.beTrigger;
      if (hit) {
        st.beAppliedId = position.id;
        const beStop = isL ? position.entryPrice + p.beOffset : position.entryPrice - p.beOffset;
        const sl = position.sl == null
          ? beStop
          : (isL ? Math.max(position.sl, beStop) : Math.min(position.sl, beStop));
        return { action: 'modify', sl };
      }
    }

    // ── Ré-armer l'ordre stop de revanche pour la bougie suivante
    if (st.rv && !position) {
      return {
        action: st.rv.dir === 1 ? 'buyStop' : 'sellStop',
        price:  st.rv.entryLvl,
        sl:     st.rv.stopLvl,
        tp:     st.rv.tpLvl,
        reason: st.rv.dir === 1 ? 'revanche long' : 'revanche short',
      };
    }

    return null;
  },
};
