// Script du motif RINGBLE.
//
// IL NE DÉTECTE RIEN LUI-MÊME. La détection est celle du panneau Patterns, lue
// telle quelle dans `context.patterns` : les seuils du motif se règlent à UN
// endroit, on les voit sur le graphe, et le script joue exactement les figures
// qui y sont dessinées. Régler la détection ici en double serait le meilleur
// moyen de backtester autre chose que ce qu'on regarde.
//
// Ce fichier ne décide donc que d'une chose : QUE FAIRE d'une figure. Entrée,
// stop, objectif, taille, break-even, sortie en temps. Rien d'autre.
//
// LE SENS vient du motif : un BH s'achète, un HB se vend. Le filtrer ici serait
// redondant — le panneau a déjà son réglage « Direction ».

import { calcRingble } from '../../ringble/detect';
import { detectOptions } from '../../ringble/params';
import { atrArr } from '../../backtest/ta';

// Les réglages du motif tels que le graphe les affiche. Absent du contexte
// (script lancé sans graphe), on retombe sur les défauts du motif — jamais sur
// des valeurs inventées ici.
const patternOf = context => detectOptions(
  (context?.patterns ?? []).find(p => p.type === 'RINGBLE') ?? {},
);

const off = v => (v > 0 ? v : null);

export default {
  id:    'ringble',
  label: 'ringble',
  desc:  'Joue le motif ringble du graphe — la détection vient du panneau Patterns',
  color: '#F472B6',

  defaults: {
    // Entrée
    entryMode:      'market',
    entryOffsetPts: 0,
    entryWaitBars:  3,
    // Stop
    slMode:      'structure',
    slMarginPts: 0,
    slPts:       50,
    atrPeriod:   14,
    atrMult:     1.5,
    // Objectif
    tpMode: 'rr',
    rr:     2,
    tpPts:  100,
    // Taille
    lotMode:   'risk',
    riskPct:   1,
    fixedLots: 0.1,
    // Gestion
    beTriggerR:   0,
    beLevelR:     0,
    maxBarsHeld:  0,
    maxPositions: 1,
  },

  fields: [
    { kind: 'hint', text:
      "Ce script ne détecte rien : il joue les ringble du GRAPHE, avec les seuils réglés dans le "
      + "panneau Patterns (taille, corps, extrême, direction). Changer la détection se fait là-bas, "
      + "et le script suit — ce qui est backtesté est exactement ce qui est dessiné." },

    { kind: 'divider', label: 'Entrée' },
    { kind: 'segmented', key: 'entryMode', label: 'Entrée', options: [
      { value: 'market', label: 'Marché' },
      { value: 'stop',   label: 'Cassure' },
      { value: 'limit',  label: 'Retour' },
    ] },
    { kind: 'hint', text:
      "MARCHÉ — à l'ouverture de la bougie qui suit le motif, toujours servi. CASSURE — ordre stop "
      + "au-delà de la 2e bougie, dans son sens : on n'entre que si le mouvement continue. RETOUR — "
      + "ordre limite sur l'extrême du motif : on n'entre que si le prix y revient. Dans les deux "
      + "derniers cas, l'ordre non servi expire et le signal ne devient jamais une position." },
    { kind: 'hint', when: p => p.entryMode === 'limit' && p.slMode === 'structure', text:
      "⚠ « Retour » vise l'extrême du motif, exactement là où le stop structurel se pose. Sans "
      + "décalage d'entrée NI marge de stop, les deux tombent au même prix : le risque est nul, "
      + "donc la taille aussi, et aucun ordre ne part. Donne l'un ou l'autre." },
    { kind: 'row', when: p => p.entryMode !== 'market', fields: [
      { kind: 'number', key: 'entryOffsetPts', label: 'Décalage (points)', min: 0, max: 100000, step: 1 },
      { kind: 'number', key: 'entryWaitBars',  label: 'Attente (bougies)', min: 1, max: 200, step: 1 },
    ] },

    { kind: 'divider', label: 'Stop' },
    { kind: 'segmented', key: 'slMode', label: 'Stop', options: [
      { value: 'structure', label: 'Structure' },
      { value: 'points',    label: 'Points' },
      { value: 'atr',       label: 'ATR' },
    ] },
    { kind: 'number', key: 'slMarginPts', label: 'Marge sous l’extrême (points)', min: 0, max: 100000, step: 1,
      when: p => p.slMode === 'structure' },
    { kind: 'number', key: 'slPts', label: 'Stop (points)', min: 1, max: 100000, step: 1,
      when: p => p.slMode === 'points' },
    { kind: 'row', when: p => p.slMode === 'atr', fields: [
      { kind: 'number', key: 'atrPeriod', label: 'Période ATR', min: 1, max: 500, step: 1 },
      { kind: 'number', key: 'atrMult',   label: 'Stop = ATR ×', min: 0.1, max: 20, step: 0.1 },
    ] },
    { kind: 'hint', text:
      "STRUCTURE — sous le plus BAS des deux bougies pour un achat, au-dessus du plus HAUT pour une "
      + "vente, moins la marge. C'est le point que le motif désigne : s'il est repris, la figure est "
      + "démentie. Le risque varie alors d'une position à l'autre, ce qui est le propre d'un stop "
      + "structurel. POINTS et ATR donnent un risque constant, mais qui ne veut plus rien dire du motif." },

    { kind: 'divider', label: 'Objectif' },
    { kind: 'segmented', key: 'tpMode', label: 'Objectif', options: [
      { value: 'rr',     label: '× risque' },
      { value: 'points', label: 'Points' },
      { value: 'none',   label: 'Aucun' },
    ] },
    { kind: 'number', key: 'rr',    label: 'Objectif (× risque)', min: 0.1, max: 50, step: 0.1,
      when: p => p.tpMode === 'rr' },
    { kind: 'number', key: 'tpPts', label: 'Objectif (points)',   min: 1, max: 1000000, step: 1,
      when: p => p.tpMode === 'points' },
    { kind: 'hint', text:
      "Sans objectif, la position ne sort qu'au stop, au break-even ou à la sortie en temps — à "
      + "n'utiliser qu'avec l'une des deux, sinon elle court jusqu'à la fin des données.",
      when: p => p.tpMode === 'none' },

    { kind: 'divider', label: 'Taille' },
    { kind: 'segmented', key: 'lotMode', label: 'Taille', options: [
      { value: 'risk',  label: '% du capital' },
      { value: 'fixed', label: 'Lot fixe' },
    ] },
    { kind: 'number', key: 'riskPct',   label: 'Risque par trade (%)', min: 0.01, max: 100, step: 0.1,
      when: p => p.lotMode === 'risk' },
    { kind: 'number', key: 'fixedLots', label: 'Lots', min: 0.01, max: 1000, step: 0.01,
      when: p => p.lotMode === 'fixed' },
    { kind: 'hint', text:
      "En % du capital, la taille est calculée sur la distance réelle entrée→stop et sur l'ÉQUITÉ du "
      + "moment : elle grandit avec le compte et rétrécit après une perte.",
      when: p => p.lotMode === 'risk' },

    { kind: 'divider', label: 'Gestion' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'beTriggerR', label: 'Break-even à (R)',  min: 0, max: 20, step: 0.1 },
      { kind: 'number', key: 'beLevelR',   label: 'Stop porté à (R)',  min: -5, max: 20, step: 0.1 },
    ] },
    { kind: 'hint', text:
      "Déclencheur à 0 = pas de break-even. Le déplacement est UNIQUE — ce n'est pas un stop suiveur "
      + "— et n'a lieu qu'à la clôture de la bougie qui l'a armé, pour qu'une mèche ne puisse pas "
      + "déclencher puis toucher le stop dans la même bougie." },
    { kind: 'row', fields: [
      { kind: 'number', key: 'maxBarsHeld',  label: 'Sortie après N bougies (0 = off)', min: 0, max: 5000, step: 1 },
      { kind: 'number', key: 'maxPositions', label: 'Positions simultanées', min: 1, max: 50, step: 1 },
    ] },
    { kind: 'hint', text:
      "À 1 position simultanée, un motif qui survient pendant qu'une position est ouverte est IGNORÉ. "
      + "Ce n'est pas un filtre neutre : il écarte des signaux selon ce que le marché a fait "
      + "entre-temps, et une position qui traîne masque les suivants. Si ceux-là étaient les mauvais, "
      + "la stratégie paraît meilleure sans avoir changé." },
  ],

  // Ce que le panneau affiche sous la carte du script : les réglages de
  // détection RÉELLEMENT utilisés, pour qu'on n'ait pas à ouvrir l'autre panneau
  // pour savoir ce qu'on joue.
  summary({ context }) {
    const d = patternOf(context);
    const side = (suffix) => {
      const min = d[`ratioMin${suffix}`], max = d[`ratioMax${suffix}`];
      const taille = min > 0 || max > 0
        ? `×${min > 0 ? min : '—'}–${max > 0 ? max : '—'}`
        : 'taille libre';
      const corps = d[`bodyRatio2${suffix}`] > 0 ? `corps ≥${d[`bodyRatio2${suffix}`]}` : 'corps libre';
      const ext   = d[`extremeBars${suffix}`] > 0 ? `extrême ${d[`extremeBars${suffix}`]}` : 'sans extrême';
      return `${taille} · ${corps} · ${ext}`;
    };
    const dir = d.direction === 'bull' ? 'BH seul' : d.direction === 'bear' ? 'HB seul' : 'BH + HB';
    return `${dir} — BH ${side('Bull')} | HB ${side('Bear')}`;
  },

  setup({ candles, params, context }) {
    // Les figures, détectées une fois pour toutes avec les réglages DU GRAPHE.
    const signals = calcRingble(candles, patternOf(context));

    // Index de la 2e bougie → figure. Le motif n'est connu qu'à sa clôture, donc
    // c'est là que le script le voit, et l'entrée se fait à la bougie suivante.
    const byIdx = new Map();
    for (const s of signals) byIdx.set(s.idx, s);

    return {
      byIdx,
      count: signals.length,
      atr: params.slMode === 'atr' ? atrArr(candles, params.atrPeriod) : null,
      announced: false,
    };
  },

  onBar({ candles, i, state, params, api }) {
    // Dire une fois ce qu'on joue : sans ça, un run sans trade laisse le doute
    // entre « aucune figure » et « aucune position prise ».
    if (!state.announced) {
      state.announced = true;
      api.log(`${state.count} ringble détectés sur les bougies chargées`);
    }

    // ── Positions ouvertes : break-even, puis sortie en temps ──────────────
    for (const pos of api.positions) {
      if (params.beTriggerR > 0 && !pos.beMoved && pos.sl0 != null) {
        const risk = Math.abs(pos.entryPrice - pos.sl0);
        if (risk > 0 && pos.maxFavorPts >= params.beTriggerR * risk) {
          const dir = pos.side === 'BUY' ? 1 : -1;
          api.modify(pos, { sl: pos.entryPrice + dir * params.beLevelR * risk });
        }
      }
      if (params.maxBarsHeld > 0 && i - pos.entryIndex >= params.maxBarsHeld) {
        api.close(pos, 'temps');
      }
    }

    // ── Un motif se clôt-il sur cette bougie ? ────────────────────────────
    const sig = state.byIdx.get(i);
    if (!sig) return;
    if (api.positions.length + api.pending.length >= params.maxPositions) return;

    const b1   = candles[sig.fromIdx];
    const b2   = candles[sig.idx];
    const isBuy = sig.side === 'bull';
    const dir   = isBuy ? 1 : -1;

    // L'extrême du motif — celui que la figure désigne (bas d'un BH, haut d'un
    // HB) — et son opposé, qui sert à la cassure.
    const extreme = sig.value;
    const opposite = isBuy ? Math.max(b1.high, b2.high) : Math.min(b1.low, b2.low);

    // ── Le stop, connu AVANT d'entrer ─────────────────────────────────────
    let sl = null;
    if (params.slMode === 'structure') {
      sl = extreme - dir * params.slMarginPts;
    } else if (params.slMode === 'atr') {
      const a = state.atr?.[i];
      if (!(a > 0)) return;                 // ATR pas encore calculable
      sl = null;                            // relatif au prix de remplissage
    }

    // ── L'ordre ───────────────────────────────────────────────────────────
    const order = {
      tag: sig.side === 'bull' ? 'BH' : 'HB',
      sl,
      slPts: params.slMode === 'points' ? params.slPts
           : params.slMode === 'atr'    ? state.atr[i] * params.atrMult
           : 0,
    };

    if (params.tpMode === 'rr')          order.rr    = params.rr;
    else if (params.tpMode === 'points') order.tpPts = params.tpPts;

    if (params.lotMode === 'fixed') order.lots    = params.fixedLots;
    else                            order.riskPct = params.riskPct;

    if (params.entryMode === 'stop') {
      order.type       = 'stop';
      order.price      = opposite + dir * params.entryOffsetPts;
      order.expireBars = params.entryWaitBars;
    } else if (params.entryMode === 'limit') {
      order.type       = 'limit';
      order.price      = extreme + dir * params.entryOffsetPts;
      order.expireBars = params.entryWaitBars;
    }

    // ENTRÉE ET STOP AU MÊME PRIX — le réglage est impossible, pas le motif.
    // Le cas type : entrée « Retour » posée SUR l'extrême et stop structurel
    // SANS marge, qui visent le même point ; la distance de risque est nulle,
    // donc la taille aussi, et le compte refuserait chaque ordre. On le DIT une
    // fois et on n'envoie rien, plutôt que de laisser un run rendre zéro trade
    // sans que rien n'explique pourquoi.
    if (order.price != null && sl != null && Math.abs(order.price - sl) < 1e-9) {
      if (!state.warnedFlat) {
        state.warnedFlat = true;
        api.log(
          "Entrée et stop au même prix — l'entrée « Retour » vise l'extrême du motif, où le stop "
          + 'structurel se trouve déjà. Donne un décalage d\'entrée, ou une marge de stop.',
        );
      }
      return;
    }

    // Un stop du mauvais côté du prix d'entrée reste possible (un motif
    // dégénéré, une cassure très éloignée) : on le laisse passer plutôt que de
    // le corriger en douce — le moteur remplira au pire, et le rapport le montrera.
    if (isBuy) api.buy(order);
    else       api.sell(order);
  },
};
