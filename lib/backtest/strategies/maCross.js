// Croisement de moyennes mobiles — stratégie de tendance de référence.
// Entrée au croisement rapide/lente, SL à distance ATR, TP en multiple de R.
// Sert de modèle pour le contrat de stratégie : setup() précalcule les
// indicateurs alignés, onBar() ne lit jamais au-delà de l'index i.

import { sourceArr, maArr, atrArr, crossOver, crossUnder } from '../ta';

export default {
  id:    'ma-cross',
  label: 'Croisement MA',
  desc:  'Croisement de deux moyennes mobiles, SL en distance ATR, TP en multiple de R',

  params: [
    { key: 'maType',     label: 'Type de MA',              type: 'select', def: 'EMA',   options: ['EMA', 'SMA', 'WMA'] },
    { key: 'fastPeriod', label: 'Période rapide',          type: 'int',    def: 9,       min: 2,   max: 200 },
    { key: 'slowPeriod', label: 'Période lente',           type: 'int',    def: 21,      min: 3,   max: 400 },
    { key: 'source',     label: 'Source',                  type: 'select', def: 'close', options: ['close', 'open', 'hl2', 'hlc3', 'ohlc4'] },
    { key: 'direction',  label: 'Direction',               type: 'select', def: 'both',  options: ['both', 'long', 'short'] },
    { key: 'atrPeriod',  label: 'Période ATR (SL)',        type: 'int',    def: 14,      min: 2,   max: 100 },
    { key: 'slAtrMult',  label: 'SL (× ATR)',              type: 'float',  def: 1.5,     min: 0.2, max: 10, step: 0.1 },
    { key: 'tpRR',       label: 'TP (multiple de R)',      type: 'float',  def: 2,       min: 0.2, max: 20, step: 0.1 },
    { key: 'exitOnCross', label: 'Sortir au croisement opposé', type: 'bool', def: true,
      hint: 'Si activé, un croisement inverse ferme (ou retourne) la position même sans toucher SL/TP.' },
  ],

  setup(candles, p) {
    const src = sourceArr(candles, p.source);
    return {
      fast: maArr(src, p.fastPeriod, p.maType),
      slow: maArr(src, p.slowPeriod, p.maType),
      atr:  atrArr(candles, p.atrPeriod),
    };
  },

  onBar({ candles, i, ind, position, params: p }) {
    const up   = crossOver(ind.fast, ind.slow, i);
    const down = crossUnder(ind.fast, ind.slow, i);
    if (!up && !down) return null;

    // Position ouverte + exitOnCross désactivé → seuls SL/TP peuvent sortir
    if (position && !p.exitOnCross) return null;

    const atr = ind.atr[i];
    if (atr == null) return null;

    const close = candles[i].close;

    if (up && p.direction !== 'short') {
      const sl = close - atr * p.slAtrMult;
      return { action: 'buy', sl, tp: close + (close - sl) * p.tpRR, reason: 'golden cross' };
    }
    if (down && p.direction !== 'long') {
      const sl = close + atr * p.slAtrMult;
      return { action: 'sell', sl, tp: close - (sl - close) * p.tpRR, reason: 'death cross' };
    }
    // Croisement dans le sens interdit → sert uniquement de signal de sortie
    if (position && p.exitOnCross) return { action: 'close', reason: 'croisement opposé' };
    return null;
  },
};
