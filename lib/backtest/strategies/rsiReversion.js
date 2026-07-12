// Retour à la moyenne sur RSI : entrée quand le RSI RESSORT de la zone
// extrême (croisement de retour au-dessus du seuil de survente / en dessous
// du seuil de surachat), pas au simple contact — évite d'attraper le couteau.

import { sourceArr, rsiArr, atrArr } from '../ta';

export default {
  id:    'rsi-reversion',
  label: 'RSI Retour à la moyenne',
  desc:  'Achat quand le RSI ressort de survente, vente quand il ressort de surachat',

  params: [
    { key: 'period',     label: 'Période RSI',        type: 'int',    def: 14,      min: 2,   max: 100 },
    { key: 'oversold',   label: 'Seuil de survente',  type: 'int',    def: 30,      min: 5,   max: 49 },
    { key: 'overbought', label: 'Seuil de surachat',  type: 'int',    def: 70,      min: 51,  max: 95 },
    { key: 'source',     label: 'Source',             type: 'select', def: 'close', options: ['close', 'open', 'hl2', 'hlc3', 'ohlc4'] },
    { key: 'direction',  label: 'Direction',          type: 'select', def: 'both',  options: ['both', 'long', 'short'] },
    { key: 'atrPeriod',  label: 'Période ATR (SL)',   type: 'int',    def: 14,      min: 2,   max: 100 },
    { key: 'slAtrMult',  label: 'SL (× ATR)',         type: 'float',  def: 1.5,     min: 0.2, max: 10, step: 0.1 },
    { key: 'tpRR',       label: 'TP (multiple de R)', type: 'float',  def: 1.5,     min: 0.2, max: 20, step: 0.1 },
  ],

  setup(candles, p) {
    return {
      rsi: rsiArr(sourceArr(candles, p.source), p.period),
      atr: atrArr(candles, p.atrPeriod),
    };
  },

  onBar({ candles, i, ind, position, params: p }) {
    if (position || i < 1) return null;

    const rsi = ind.rsi, atr = ind.atr[i];
    if (rsi[i] == null || rsi[i - 1] == null || atr == null) return null;

    const close = candles[i].close;

    // RSI repasse AU-DESSUS du seuil de survente → achat
    if (p.direction !== 'short' && rsi[i - 1] < p.oversold && rsi[i] >= p.oversold) {
      const sl = close - atr * p.slAtrMult;
      return { action: 'buy', sl, tp: close + (close - sl) * p.tpRR, reason: `RSI ${rsi[i].toFixed(1)} sort de survente` };
    }
    // RSI repasse EN DESSOUS du seuil de surachat → vente
    if (p.direction !== 'long' && rsi[i - 1] > p.overbought && rsi[i] <= p.overbought) {
      const sl = close + atr * p.slAtrMult;
      return { action: 'sell', sl, tp: close - (sl - close) * p.tpRR, reason: `RSI ${rsi[i].toFixed(1)} sort de surachat` };
    }

    return null;
  },
};
