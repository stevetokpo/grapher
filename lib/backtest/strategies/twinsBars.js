// Stratégie basée sur le pattern Twins Bars existant (lib/patterns.js) :
// entrée à l'open suivant la détection, SL sous/sur l'extrême du pattern
// (± marge ATR), TP en multiple de R. Montre comment brancher n'importe quel
// détecteur de lib/patterns.js sur le moteur de backtest.

import { calcTwinsBars } from '../../patterns';
import { atrArr } from '../ta';

export default {
  id:    'twins-bars',
  label: 'Twins Bars',
  desc:  'Entrée sur détection du pattern Twins Bars, SL à l\'extrême du pattern',

  params: [
    { key: 'direction',       label: 'Direction',                    type: 'select', def: 'both', options: ['both', 'bull', 'bear'] },
    { key: 'similarityRatio', label: 'Ratio de similarité',          type: 'float',  def: 0.7,   min: 0.1, max: 1,  step: 0.05 },
    { key: 'atrPeriod',       label: 'Période ATR filtre (0 = off)', type: 'int',    def: 7,     min: 0,   max: 50 },
    { key: 'atrMult',         label: 'Multiplicateur ATR filtre',    type: 'float',  def: 1.6,   min: 0.1, max: 5,  step: 0.1 },
    { key: 'slBufferAtr',     label: 'Marge SL (× ATR14)',           type: 'float',  def: 0.25,  min: 0,   max: 3,  step: 0.05 },
    { key: 'tpRR',            label: 'TP (multiple de R)',           type: 'float',  def: 2,     min: 0.2, max: 20, step: 0.1 },
  ],

  setup(candles, p) {
    // calcTwinsBars ne lit que le passé à chaque index → précalcul sans lookahead.
    // signals.value = extrême du pattern (min des lows en bull, max des highs en bear).
    const signals = calcTwinsBars(candles, {
      direction:       p.direction,
      atrPeriod:       p.atrPeriod,
      atrMult:         p.atrMult,
      similarityRatio: p.similarityRatio,
    });
    const byTime = new Map(signals.map(s => [s.time, s]));
    return { byTime, atr: atrArr(candles, 14) };
  },

  onBar({ candles, i, ind, position, params: p }) {
    if (position) return null;

    const sig = ind.byTime.get(candles[i].time);
    if (!sig) return null;

    const atr = ind.atr[i];
    if (atr == null) return null;

    const close  = candles[i].close;
    const buffer = atr * p.slBufferAtr;

    if (sig.side === 'bull') {
      const sl = sig.value - buffer;
      if (close <= sl) return null;
      return { action: 'buy', sl, tp: close + (close - sl) * p.tpRR, reason: 'Twins Bars haussier' };
    }
    const sl = sig.value + buffer;
    if (close >= sl) return null;
    return { action: 'sell', sl, tp: close - (sl - close) * p.tpRR, reason: 'Twins Bars baissier' };
  },
};
