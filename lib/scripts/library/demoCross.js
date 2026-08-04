// Script de DÉMONSTRATION — croisement de deux moyennes.
//
// Il n'est pas là pour gagner de l'argent : il est là pour que chaque partie de
// l'environnement soit exercée par du vrai code, et pour servir de modèle au
// prochain script. Il montre, dans l'ordre : le précalcul dans `setup`, le
// dimensionnement en % du capital, l'entrée au marché avec SL en points et TP en
// RR, le déplacement de stop au break-even, la sortie discrétionnaire, et la
// possibilité d'empiler plusieurs positions — c'est ce dernier point qui fait
// apparaître les appels de marge, donc le seul moyen de vérifier qu'ils marchent.
//
// À copier pour écrire le vrai script. Les seules obligations sont : un `id`
// unique, un `defaults`, un `fields` (même grammaire que lib/xfvg/params.js) et
// un `onBar`.

import { sourceArr, maArr, atrArr, crossOver, crossUnder } from '../../backtest/ta';

export default {
  id:    'demo-cross',
  label: 'Démo — croisement MM',
  desc:  'Croisement de deux moyennes, risque en % du capital, stop en points, TP en RR',
  color: '#60A5FA',

  defaults: {
    fastPeriod: 20,
    slowPeriod: 50,
    maType:     'EMA',
    direction:  'both',
    riskPct:    1,
    fixedLots:  0,      // > 0 : lot fixe, le risque en % est alors ignoré
    slMode:     'points',
    slPts:      50,
    atrPeriod:  14,
    atrMult:    2,
    rr:         2,
    beTriggerR: 0,      // 0 = pas de break-even
    beLevelR:   0,
    maxPositions: 1,
    closeOnCross: true,
  },

  fields: [
    { kind: 'hint', text:
      "Script de démonstration : il sert à vérifier que la chaîne complète tourne "
      + "(dimensionnement, marge, stops, rapport). Ses résultats n'ont aucune valeur." },

    { kind: 'divider', label: 'Signal' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'fastPeriod', label: 'MM rapide', min: 1, max: 500, step: 1 },
      { kind: 'number', key: 'slowPeriod', label: 'MM lente',  min: 2, max: 1000, step: 1 },
    ] },
    { kind: 'segmented', key: 'maType', label: 'Type', options: [
      { value: 'SMA', label: 'SMA' },
      { value: 'EMA', label: 'EMA' },
      { value: 'WMA', label: 'WMA' },
    ] },
    { kind: 'segmented', key: 'direction', label: 'Direction', options: [
      { value: 'bull', label: '↑ Achat' },
      { value: 'both', label: '↕ Les deux' },
      { value: 'bear', label: '↓ Vente' },
    ] },
    { kind: 'toggle', key: 'closeOnCross', label: 'Sortir au croisement inverse', on: 'Oui', off: 'Non' },

    { kind: 'divider', label: 'Taille de position' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'riskPct',   label: 'Risque par trade (%)', min: 0, max: 100, step: 0.1 },
      { kind: 'number', key: 'fixedLots', label: 'Lot fixe (0 = auto)',  min: 0, max: 1000, step: 0.01 },
    ] },
    { kind: 'number', key: 'maxPositions', label: 'Positions simultanées max', min: 1, max: 50, step: 1 },
    { kind: 'hint', text:
      "Avec un lot fixe à 0, la taille est calculée pour risquer ce pourcentage de l'ÉQUITÉ "
      + "courante sur la distance au stop. Monter le nombre de positions simultanées est le "
      + "moyen le plus simple de provoquer un appel de marge et de voir le compte réagir." },

    { kind: 'divider', label: 'Stop et objectif' },
    { kind: 'segmented', key: 'slMode', label: 'Stop', options: [
      { value: 'points', label: 'Points' },
      { value: 'atr',    label: 'ATR' },
    ] },
    { kind: 'number', key: 'slPts', label: 'Stop (points)', min: 1, max: 100000, step: 1,
      when: p => p.slMode === 'points' },
    { kind: 'row', when: p => p.slMode === 'atr', fields: [
      { kind: 'number', key: 'atrPeriod', label: 'Période ATR', min: 1, max: 500, step: 1 },
      { kind: 'number', key: 'atrMult',   label: 'Stop = ATR ×', min: 0.1, max: 20, step: 0.1 },
    ] },
    { kind: 'number', key: 'rr', label: 'Objectif (× risque)', min: 0, max: 50, step: 0.1 },
    { kind: 'hint', text: "Objectif à 0 : aucun TP, la position ne sort qu'au stop ou au croisement inverse." },

    { kind: 'divider', label: 'Break-even' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'beTriggerR', label: 'Déclencheur (R)', min: 0, max: 20, step: 0.1 },
      { kind: 'number', key: 'beLevelR',   label: 'Stop porté à (R)', min: -5, max: 20, step: 0.1 },
    ] },
    { kind: 'hint', text:
      "Déclencheur à 0 = désactivé. Le déplacement est UNIQUE — ce n'est pas un stop suiveur — et "
      + "n'a lieu qu'à la clôture de la bougie qui l'a armé, pour qu'une mèche ne puisse pas "
      + "déclencher puis toucher le stop dans la même bougie." },
  ],

  setup({ candles, params }) {
    const src  = sourceArr(candles, 'close');
    return {
      fast: maArr(src, params.fastPeriod, params.maType),
      slow: maArr(src, params.slowPeriod, params.maType),
      atr:  atrArr(candles, params.atrPeriod),
    };
  },

  onBar({ bar, i, state, params, account, api }) {
    const { fast, slow, atr } = state;
    if (fast[i] == null || slow[i] == null) return;

    // ── Gestion des positions ouvertes ────────────────────────────────────
    const open = api.positions;
    for (const pos of open) {
      if (params.beTriggerR > 0 && !pos.beMoved && pos.sl0 != null) {
        const risk = Math.abs(pos.entryPrice - pos.sl0);
        if (risk > 0 && pos.maxFavorPts >= params.beTriggerR * risk) {
          const dir = pos.side === 'BUY' ? 1 : -1;
          api.modify(pos, { sl: pos.entryPrice + dir * params.beLevelR * risk });
        }
      }
    }

    const up   = crossOver(fast, slow, i);
    const down = crossUnder(fast, slow, i);
    if (!up && !down) return;

    if (params.closeOnCross) {
      for (const pos of open) {
        if ((up && pos.side === 'SELL') || (down && pos.side === 'BUY')) api.close(pos, 'signal');
      }
    }

    const wantsBuy  = up   && params.direction !== 'bear';
    const wantsSell = down && params.direction !== 'bull';
    if (!wantsBuy && !wantsSell) return;
    if (api.positions.length >= params.maxPositions) return;

    // Distance de stop, connue AVANT l'entrée : c'est elle qui dimensionne.
    const stopPts = params.slMode === 'atr'
      ? (atr[i] ?? 0) * params.atrMult
      : params.slPts;
    if (!(stopPts > 0)) return;

    const lots = params.fixedLots > 0
      ? params.fixedLots
      : api.lotsForRisk(params.riskPct, stopPts);
    if (!(lots > 0)) return;

    const order = { lots, slPts: stopPts, rr: params.rr > 0 ? params.rr : 0, tag: 'cross' };
    if (wantsBuy) api.buy(order);
    else          api.sell(order);
  },
};
