// Script du motif rFVG / aFVG — avec un COMPTE et un ESCALIER DE LOTS.
//
// IL NE DÉTECTE RIEN LUI-MÊME : les zones sont celles du panneau Patterns, lues
// dans `context.patterns`, exactement comme le fait le script ringble. Ce qui est
// joué ici est donc ce qui est dessiné là-bas — un réglage, un endroit.
//
// POURQUOI CE SCRIPT EXISTE alors que /rfvg mesure déjà le motif. Parce que ces
// deux-là ne répondent pas à la même question. La page rFVG compte des POINTS à
// lot implicite : elle dit si le motif gagne. Ce script part d'un CAPITAL, en
// tire des lots qui grandissent avec lui, immobilise de la marge et peut se faire
// liquider : il dit ce que le capital serait devenu. Une espérance positive en
// points ne garantit rien de la seconde question — l'ordre des trades, lui,
// compte, et c'est tout l'objet de l'escalier (lib/scripts/lotLadder.js).
//
// LES SORTIES SONT CELLES DU MOTEUR COMMUN (lib/signals/engine.js) : entrée au
// marché à l'ouverture de B4, stop STRUCTUREL posé à la clôture de B4 sous
// l'extrême des deux dernières bougies, TP en points, break-even à quatre
// déclencheurs. Trois différences ASSUMÉES, parce qu'un script ne voit le marché
// qu'à la clôture des bougies là où le moteur le parcourt :
//   • un stop déplacé (break-even, durée, swing) prend effet à la CLÔTURE de la
//     bougie qui l'arme, donc une bougie plus tard que dans le moteur ;
//   • si le niveau visé se trouve du MAUVAIS CÔTÉ du prix au moment de l'armer —
//     le cas ordinaire du déclencheur de durée sur une position perdante — la
//     position est soldée AU MARCHÉ à cette clôture. Le moteur, lui, la sortait
//     à l'ouverture de la même bougie : même décision, un prix différent ;
//   • la coupe sur RETOURS se pose en STOP au niveau choisi plutôt que de solder
//     au prix d'entrée. C'est ce qu'un EA peut réellement faire, et ça permet de
//     couper à entrée + quelques points au lieu d'exactement zéro.
// Ces écarts vont dans les deux sens et ne se compensent pas : ce script n'est
// pas un vérificateur de parité, c'est un simulateur de compte.

import { calcRFVG } from '../../patterns';
import { isSwingAt } from '../../signals/engine';
import { DETECT_DEFAULTS } from '../../rfvg/simulate';
import { LADDER_DEFAULTS, ladderFields, createLotLadder } from '../lotLadder';

// Les réglages de détection du GRAPHE. Absents (script lancé sans panneau), on
// retombe sur les défauts du motif — jamais sur des valeurs inventées ici.
const patternOf = (context) => {
  const pat = (context?.patterns ?? []).find(p => p.type === 'RFVG') ?? {};
  const out = { ...DETECT_DEFAULTS };
  for (const k of Object.keys(DETECT_DEFAULTS)) if (pat[k] !== undefined) out[k] = pat[k];
  return out;
};

export default {
  id:    'rfvg-paliers',
  label: 'rFVG · escalier de lots',
  desc:  'Joue le rFVG du graphe sur un compte, avec un lot qui monte par paliers',
  color: '#FB923C',

  defaults: {
    // Sorties — les valeurs du moteur commun
    slMarginPts:    2,
    tpPts:          100,
    beTriggerPts:   0,
    beLevelPts:     0,
    beBarsTrigger:  0,
    beSwingBars:    0,
    beTouchTrigger: 0,
    beTouchLevelPts: 0,
    maxPositions:   0,
    // Taille
    sizeMode: 'escalier',      // 'escalier' | 'risque'
    riskPct:  1,
    ...LADDER_DEFAULTS,
  },

  fields: [
    { kind: 'hint', text:
      "Ce script ne détecte rien : il joue les rFVG / aFVG du GRAPHE, avec les réglages du panneau "
      + "Patterns (mode, MM, ATR, direction, hauteur de zone). La détection se change là-bas, et le "
      + "script suit — ce qui est simulé est exactement ce qui est dessiné." },

    { kind: 'divider', label: 'Sorties' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'slMarginPts', label: 'Marge du stop (points)', min: 0, max: 100000, step: 1 },
      { kind: 'number', key: 'tpPts',       label: 'Objectif (points)',      min: 1, max: 1000000, step: 1 },
    ] },
    { kind: 'hint', text:
      "Stop STRUCTUREL : sous le plus bas des deux dernières bougies (achat), au-dessus du plus haut "
      + "(vente), moins la marge — et posé seulement à la CLÔTURE de la bougie d'entrée, comme dans le "
      + "moteur. Le risque varie donc d'une position à l'autre : c'est le propre d'un stop structurel, "
      + "et c'est pourquoi le lot ne peut pas être déduit d'un risque constant sans approximation." },

    { kind: 'divider', label: 'Break-even' },
    { kind: 'row', fields: [
      { kind: 'number', key: 'beTriggerPts', label: 'Profit — seuil (points)', min: 0, max: 1000000, step: 1 },
      { kind: 'number', key: 'beLevelPts',   label: 'Stop porté à (points)',   min: -100000, max: 100000, step: 1 },
    ] },
    { kind: 'row', fields: [
      { kind: 'number', key: 'beBarsTrigger', label: 'Durée — bougies', min: 0, max: 5000, step: 1 },
      { kind: 'number', key: 'beSwingBars',   label: 'Swing — bougies g/d', min: 0, max: 50, step: 1 },
    ] },
    { kind: 'row', fields: [
      { kind: 'number', key: 'beTouchTrigger',  label: 'Retours — nombre', min: 0, max: 100, step: 1 },
      { kind: 'number', key: 'beTouchLevelPts', label: 'Coupe à entrée + (points)', min: -10000, max: 10000, step: 1 },
    ] },
    { kind: 'hint', text:
      "Les trois premiers DÉPLACENT le stop, une seule fois, le premier armé gagne ; jamais au-delà du "
      + "stop structurel — un déplacement resserre, il n'élargit pas. RETOURS pose un stop à "
      + "entrée + le décalage donné dès que le prix est revenu ce nombre de fois sur l'entrée : à 0 "
      + "c'est la coupe au point mort du rapport, au-dessus c'est le même abandon mais en gardant "
      + "quelques points — à condition que le prix soit encore au-dessus, sinon la position sort au "
      + "marché à cette clôture." },
    { kind: 'number', key: 'maxPositions', label: 'Positions simultanées (0 = sans limite)', min: 0, max: 50, step: 1 },

    { kind: 'divider', label: 'Taille' },
    { kind: 'segmented', key: 'sizeMode', label: 'Taille', options: [
      { value: 'escalier', label: 'Escalier' },
      { value: 'risque',   label: '% du capital' },
    ] },
    { kind: 'number', key: 'riskPct', label: 'Risque par trade (%)', min: 0.01, max: 100, step: 0.1,
      when: p => p.sizeMode === 'risque' },
    { kind: 'hint', when: p => p.sizeMode === 'risque', text:
      "Le stop structurel n'est connu qu'à la clôture de la bougie d'entrée, une bougie APRÈS que "
      + "l'ordre soit parti : la taille est donc calculée sur une ESTIMATION du stop (extrême des deux "
      + "bougies du motif, marge comprise, mesuré depuis la clôture de la dernière). Le risque réalisé "
      + "s'écarte donc un peu du pourcentage demandé — c'est le prix d'un stop qu'on ne connaît pas "
      + "encore au moment d'entrer." },

    ...ladderFields(p => p.sizeMode === 'escalier'),
  ],

  // Ce que le panneau affiche sous la carte : la détection RÉELLEMENT jouée et
  // la taille. Sans ça, un rapport ne dirait pas ce qu'il a mesuré.
  summary({ params, context }) {
    const d = patternOf(context);
    const mode = d.mode === 'all' ? 'aFVG + rFVG' : d.mode === 'super' ? 'super rFVG'
      : d.mode === 'cfvg' ? 'cFVG (continuation)' : 'rFVG seul';
    const dir  = d.direction === 'bull' ? 'haussiers' : d.direction === 'bear' ? 'baissiers' : 'deux sens';
    const size = params.sizeMode === 'risque'
      ? `${params.riskPct} % du capital`
      : createLotLadder(params, 0).describe();
    return `${mode} · ${dir} · centrale ≥ ATR×${d.atrMult} (${d.sizeMode === 'body' ? 'corps' : 'amplitude'})`
         + ` · MM ${d.maPeriodFast}/${d.maPeriodSlow} — ${size}`;
  },

  setup({ candles, params, account, context }) {
    const zones = calcRFVG(candles, patternOf(context));

    // Indexées sur la bougie qui PRÉCÈDE l'entrée : c'est à sa clôture que le
    // motif est complet et que l'ordre au marché part, pour être rempli à
    // l'ouverture de la suivante. Plusieurs motifs peuvent tomber sur la même.
    const byIdx = new Map();
    for (const z of zones) {
      if (z.entryIdx == null) continue;
      const k = z.entryIdx - 1;
      if (!byIdx.has(k)) byIdx.set(k, []);
      byIdx.get(k).push(z);
    }

    return {
      byIdx,
      zoneCount: zones.length,
      ladder: createLotLadder(params, account?.capital ?? 0),
      live: new Map(),     // id de position → ce que le script doit s'en rappeler
      announced: false,
      lastLots: null,
    };
  },

  onBar({ candles, bar, i, state, params, account, api }) {
    if (!state.announced) {
      state.announced = true;
      api.log(`${state.zoneCount} zones rFVG/aFVG sur les bougies chargées`);
      if (params.sizeMode === 'escalier') {
        api.log(`Escalier : ${state.ladder.describe()}`);
        if (state.ladder.table.bad.length) {
          api.log(`⚠ paliers illisibles, ignorés : ${state.ladder.table.bad.join(' | ')}`);
        }
      }
    }

    // ── Positions ouvertes ────────────────────────────────────────────────
    for (const pos of api.positions) {
      const isBuy = pos.side === 'BUY';
      const dir   = isBuy ? 1 : -1;

      let mem = state.live.get(pos.id);
      if (!mem) {
        mem = { touches: 0, moved: false, cut: false, slStruct: null };
        state.live.set(pos.id, mem);
      }

      // LE STOP STRUCTUREL, posé à la clôture de la bougie d'entrée et pas
      // avant : jusqu'ici la position n'était protégée que par son objectif,
      // exactement comme dans le moteur. Il se construit sous l'extrême de cette
      // bougie-là, il ne peut donc pas y avoir été touché.
      if (mem.slStruct == null) {
        const prev = candles[pos.entryIndex - 1] ?? candles[pos.entryIndex];
        const bar0 = candles[pos.entryIndex];
        mem.slStruct = isBuy
          ? Math.min(prev.low,  bar0.low)  - params.slMarginPts
          : Math.max(prev.high, bar0.high) + params.slMarginPts;
        api.modify(pos, { sl: mem.slStruct });
        if (i === pos.entryIndex) continue;   // rien d'autre sur sa propre bougie
      }

      // Un stop déplacé ne peut jamais ÉLARGIR le risque : borné par le
      // structurel, comme dans le moteur.
      const clamp = lvl => (isBuy ? Math.max(lvl, mem.slStruct) : Math.min(lvl, mem.slStruct));
      // Poser un stop du mauvais côté du marché n'a pas de sens : à ce
      // moment-là, la décision est de SORTIR, et on sort au prix qui existe.
      const moveTo = (lvl, why) => {
        const stop = clamp(lvl);
        mem.moved = true;
        if (isBuy ? bar.close <= stop : bar.close >= stop) api.close(pos, why);
        else api.modify(pos, { sl: stop });
      };

      // Les trois déplacements se partagent un seul mouvement, le premier armé
      // gagne — ce n'est pas un stop suiveur.
      if (!mem.moved) {
        if (params.beTriggerPts > 0 && pos.maxFavorPts >= params.beTriggerPts) {
          moveTo(pos.entryPrice + dir * params.beLevelPts, 'be');
        } else if (params.beBarsTrigger > 0 && i - pos.entryIndex >= params.beBarsTrigger) {
          moveTo(pos.entryPrice + dir * params.beLevelPts, 'be');
        } else if (params.beSwingBars > 0) {
          // ANTI-LOOKAHEAD : un swing n'est connu qu'à la clôture de la bougie
          // pivot + beSwingBars, et c'est celle-là qui arme.
          const pv = i - params.beSwingBars;
          if (pv > pos.entryIndex && isSwingAt(candles, pv, params.beSwingBars, isBuy ? 'low' : 'high')) {
            const pivot = isBuy ? candles[pv].low - params.slMarginPts : candles[pv].high + params.slMarginPts;
            moveTo(pivot, 'be');
          }
        }
      }

      // RETOURS — compté à la clôture, comme dans le moteur, et la bougie
      // d'entrée ne compte pas (elle s'ouvre au niveau, elle compterait toujours).
      if (params.beTouchTrigger > 0 && !mem.cut && i > pos.entryIndex) {
        if (bar.low <= pos.entryPrice && bar.high >= pos.entryPrice) mem.touches++;
        if (mem.touches >= params.beTouchTrigger) {
          mem.cut = true;
          moveTo(pos.entryPrice + dir * params.beTouchLevelPts, 'retours');
        }
      }
    }

    // Les positions refermées n'ont plus rien à dire : sans ce ménage, la carte
    // grossirait jusqu'à la dernière bougie du graphe.
    if (state.live.size > 64) {
      const alive = new Set(api.positions.map(p => p.id));
      for (const id of state.live.keys()) if (!alive.has(id)) state.live.delete(id);
    }

    // ── Un motif se termine-t-il sur cette bougie ? ───────────────────────
    const sigs = state.byIdx.get(i);
    if (!sigs) return;

    for (const z of sigs) {
      if (params.maxPositions > 0 && api.positions.length + api.pending.length >= params.maxPositions) return;

      const isBuy = z.side === 'bull';
      const order = { tag: z.label, tpPts: params.tpPts };

      if (params.sizeMode === 'risque') {
        // Le stop réel n'existera qu'à la clôture de la bougie SUIVANTE. On
        // dimensionne sur son estimation : l'extrême des deux bougies connues,
        // marge comprise, mesuré depuis la clôture d'où l'on décide.
        const prev = candles[i - 1] ?? bar;
        const est  = isBuy ? Math.min(prev.low, bar.low)  - params.slMarginPts
                           : Math.max(prev.high, bar.high) + params.slMarginPts;
        const dist = Math.abs(bar.close - est);
        order.lots = dist > 0 ? api.lotsForRisk(params.riskPct, dist) : 0;
      } else {
        const ref = params.ladderRef === 'equite' ? account.equity : account.balance;
        order.lots = api.normalizeLots(state.ladder.lots(ref));
        // Une marche franchie se dit une fois : c'est la seule trace qui
        // permette de relire un run et de voir QUAND la taille a changé.
        if (order.lots !== state.lastLots) {
          if (state.lastLots != null) api.log(`Lot ${state.lastLots} → ${order.lots} (compte ${Math.round(ref)})`);
          state.lastLots = order.lots;
        }
      }

      if (!(order.lots > 0)) continue;
      if (isBuy) api.buy(order); else api.sell(order);
    }
  },
};
