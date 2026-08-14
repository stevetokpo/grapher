// BOOM · RSIER — vendre la survente d'un Boom, avec la gestion de compte qui va
// avec. Sur mesure pour Boom 1000 Index en M1, et écrit pour lui seul.
//
// CE QUE LE MOTIF FAIT, ET CE QU'IL NE FAIT PAS. La détection est celle du
// panneau Patterns, lue telle quelle dans `context.patterns` (motif RSIER) : les
// seuils se règlent à un endroit, on les voit dessinés sur le graphe, et le
// script joue exactement ces zones-là. Il n'en garde que les surzones de
// SURVENTE, et il les VEND — c'est la stratégie, pas une option : sur un Boom,
// le prix descend par petites bougies et remonte par bonds. Une survente n'y est
// pas un excès à corriger, c'est le régime normal de l'instrument.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA POCHE ET LA RÉSERVE — la seule chose qui rende ce backtest honnête
//
// Un Boom monte par SPIKES : quelques dizaines de points en une poignée de
// ticks. Un stop posé au-dessus d'une vente n'est donc pas un prix de sortie,
// c'est un vœu : il sera servi quelque part dans le bond, et personne ne sait
// où. La seule borne dure d'une perte, sur cet instrument, c'est CE QUI EST SUR
// LE COMPTE — le broker ne peut pas prendre plus.
//
// D'où le montage, qui est celui d'un compte réel et non d'un tableur :
//
//   RÉSERVE (hors du broker)        POCHE (chez le broker)
//   ─────────────────────────       ──────────────────────
//   capital − poche au départ  ───► exactement `poche` avant CHAQUE position
//            ▲                      │
//            └── tout le surplus ───┘  (retiré dès que la position est fermée)
//
//   • avant chaque entrée, le solde est remis à `poche` : on complète depuis la
//     réserve, ou on retire le surplus vers elle ;
//   • ce qui est en réserve n'est PAS exposé : ni à la marge, ni au stop out, ni
//     au spike. C'est tout l'intérêt, et c'est exactement ce que fait un trader
//     qui retire ses gains d'un compte Boom ;
//   • une poche vidée par un spike ne ruine donc pas le joueur : elle est
//     rechargée à la position suivante, et le script s'arrête quand la RÉSERVE
//     ne suit plus.
//
// Ce montage change le résultat, il ne l'embellit pas. Il coupe la queue des
// pertes (aucune ne peut dépasser la poche) mais il fait payer chaque coupure au
// prix fort : la poche entière, soit bien plus que le stop demandé. Le rapport
// compte les deux — `pochesCramees` et `pertesEffacees`.
//
// ─────────────────────────────────────────────────────────────────────────────
// CE QUI DÉCIDE DU RÉSULTAT, ET QU'IL FAUT RÉGLER AVANT DE LIRE QUOI QUE CE SOIT
//
//   1. LE GLISSEMENT DU STOP (compte → « Glissement du stop »). À 0 %, le stop
//      est servi au prix demandé : c'est l'hypothèse d'un marché continu, et
//      elle est FAUSSE sur un Boom. À 100 %, il est servi au pire prix de la
//      bougie. Mesuré sur Boom 1000 M1, l'espérance de cette stratégie passe de
//      +3 points à −1,4 point entre ces deux bornes. Tout le reste est du
//      détail à côté.
//   2. LE SPREAD (compte → « Spread »). Le broker l'écrit dans les données :
//      1,45 point en médiane sur Boom 1000, soit plus qu'une bougie M1 médiane.
//      Le laisser à zéro ajoute gratuitement ~1,5 point à chaque position.
//
// Le reste — mise, réserve, risque, RR — ne fait que transformer des points en
// dollars. Ces deux réglages-là décident du SIGNE.

import { calcRsier } from '../../rsier/detect';
import { detectOptions, DETECT_DEFAULTS } from '../../rsier/params';

// Les réglages de détection du graphe. Absent du contexte (script lancé hors
// graphe, auto-contrôle), on retombe sur ceux du motif — jamais sur des valeurs
// inventées ici, qui feraient jouer autre chose que ce qui est dessiné.
const patternOf = context => detectOptions(
  (context?.patterns ?? []).find(p => p.type === 'RSIER' && p.enabled !== false)
  ?? (context?.patterns ?? []).find(p => p.type === 'RSIER')
  ?? {},
);

const usd = v => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} $`;

export default {
  id:    'boom-rsier',
  label: 'Boom · RSIER',
  desc:  'Vend les surventes RSIER du graphe, poche remise à niveau et gains mis en réserve — Boom 1000 M1',
  color: '#F59E0B',

  defaults: {
    // ── Compte de trading ──
    poche:        7.5,     // ce qu'on laisse chez le broker à chaque position
    // ── Risque et taille ──
    lotMode:      'risque',
    risqueUsd:    5,       // ce que coûte le stop, en dollars
    lotsFixes:    0.2,
    // ── Sortie ──
    slPts:        17.33,
    tpMode:       'rr',
    rr:           1.5,
    tpPts:        26,
    tpUsd:        5,
    maxBarsHeld:  0,
    // ── Sécurité ──
    minPoche:     0,       // sous cette poche, on ne prend plus de position
    stopSiReserve: true,   // arrêter net quand la réserve ne peut plus recharger
  },

  fields: [
    { kind: 'hint', text:
      "Ce script ne détecte rien : il joue les surzones du motif RSIER du panneau Patterns, et n'en "
      + "garde que les SURVENTES, qu'il VEND. Le sens n'est pas réglable — c'est la stratégie. Régler "
      + "le RSI, son unité de temps et ses seuils se fait dans le panneau Patterns, et le script suit." },

    { kind: 'divider', label: 'Compte de trading' },
    { kind: 'number', key: 'poche', label: 'Poche laissée chez le broker (USD)', min: 0.1, max: 1000000, step: 0.5 },
    { kind: 'hint', text:
      "Le solde est remis à ce montant AVANT chaque position : on complète depuis la réserve, ou on "
      + "retire le surplus vers elle. Le capital du compte (section au-dessus) est le TOTAL — poche "
      + "plus réserve. Tout ce qui n'est pas dans la poche est hors d'atteinte du marché : c'est la "
      + "seule chose qui borne vraiment une perte sur un instrument qui bondit." },
    { kind: 'number', key: 'minPoche', label: 'Poche minimale pour entrer (0 = aucune)', min: 0, max: 1000000, step: 0.5 },
    { kind: 'hint', when: p => p.minPoche > 0, text:
      "Sous ce solde, aucune position n'est prise même si la réserve pourrait recharger. À utiliser "
      + "pour interdire les entrées « à découvert » quand la réserve s'épuise." },
    { kind: 'toggle', key: 'stopSiReserve', label: 'Arrêter quand la réserve est vide', on: 'Oui', off: 'Non' },

    { kind: 'divider', label: 'Taille de position' },
    { kind: 'segmented', key: 'lotMode', label: 'Taille', options: [
      { value: 'risque', label: 'Risque en $' },
      { value: 'fixe',   label: 'Lot fixe' },
    ] },
    { kind: 'number', key: 'risqueUsd', label: 'Risque par position (USD)', min: 0.1, max: 1000000, step: 0.5,
      when: p => p.lotMode === 'risque' },
    { kind: 'number', key: 'lotsFixes', label: 'Lots', min: 0.01, max: 1000, step: 0.01,
      when: p => p.lotMode === 'fixe' },
    { kind: 'hint', when: p => p.lotMode === 'risque', text:
      "Lots = risque ÷ (distance du stop × valeur du point). Le lot obtenu est arrondi au pas du "
      + "compte et borné par son lot minimum : sur un petit capital, c'est souvent LE lot minimum qui "
      + "décide du risque réel, pas ce chiffre. Le journal le dit à la première position." },
    { kind: 'hint', text:
      "⚠ Ce risque est celui du stop DEMANDÉ. Ce qu'une position peut réellement coûter est borné par "
      + "la poche, pas par lui — c'est tout l'objet du réglage « Glissement du stop » du compte." },

    { kind: 'divider', label: 'Sortie' },
    { kind: 'number', key: 'slPts', label: 'Stop (points)', min: 0.1, max: 100000, step: 0.01 },
    { kind: 'segmented', key: 'tpMode', label: 'Objectif', options: [
      { value: 'rr',     label: '× risque' },
      { value: 'points', label: 'Points' },
      { value: 'usd',    label: 'Dollars' },
    ] },
    { kind: 'number', key: 'rr',    label: 'Objectif (× risque)', min: 0.1, max: 50, step: 0.1,
      when: p => p.tpMode === 'rr' },
    { kind: 'number', key: 'tpPts', label: 'Objectif (points)', min: 0.1, max: 100000, step: 0.01,
      when: p => p.tpMode === 'points' },
    { kind: 'number', key: 'tpUsd', label: 'Objectif (USD)', min: 0.1, max: 1000000, step: 0.5,
      when: p => p.tpMode === 'usd' },
    { kind: 'hint', when: p => p.tpMode === 'usd', text:
      "L'objectif est converti en points au moment de l'ordre, avec le lot et la valeur du point : "
      + "viser 5 $ avec un lot deux fois plus gros, c'est un TP deux fois plus près." },
    { kind: 'number', key: 'maxBarsHeld', label: 'Sortie après N bougies (0 = off)', min: 0, max: 100000, step: 10 },
    { kind: 'hint', when: p => p.maxBarsHeld > 0, text:
      "Une vente de Boom qui n'atteint pas son objectif est une position qui attend le spike. Sortir "
      + "au temps, c'est refuser cette attente — à comparer systématiquement avec 0." },

    { kind: 'hint', text:
      "UNE SEULE POSITION À LA FOIS, et ce n'est pas un choix : la poche ne finance qu'une position. "
      + "Les surventes qui s'ouvrent pendant qu'une position court sont donc ignorées, et le journal "
      + "dit combien. ⚠ Ce n'est pas un filtre neutre — il écarte des signaux selon ce que le marché a "
      + "fait entre-temps." },
  ],

  // Ce que le panneau affiche sous la carte : les réglages de détection
  // RÉELLEMENT joués, figés dans le rapport. Le panneau Patterns peut changer
  // après le run, ce texte non.
  summary({ context }) {
    const d = patternOf(context);
    const sens = d.direction === 'bear' ? '⚠ surachat seul — aucune vente à jouer'
               : d.direction === 'both'  ? 'survente (le surachat est ignoré)'
               : 'survente';
    return `RSI ${d.rsiPeriod} en ${d.htf} · survente ≤ ${d.osLevel} · ${sens}`;
  },

  setup({ candles, params, account, context }) {
    const det   = patternOf(context);
    // `context.htfBars` : la série HTF servie par /api/htf, comme pour le motif
    // dessiné. Sans elle, le RSI n'a que ce que le graphe a chargé — sans effet
    // quand le HTF est le TF du graphe (M1 sur M1), décisif au-delà.
    const zones = calcRsier(candles, det, context?.htfBars ?? null).zones.filter(z => z.side === 'bull');

    // Index de la bougie qui PRÉCÈDE l'ouverture de la zone : c'est à sa clôture
    // que l'ordre est posé, pour être rempli à l'ouverture de la zone. La bougie
    // HTF qui a fait basculer le RSI s'est clôturée avant — rien n'est anticipé.
    const byIdx = new Map();
    for (const z of zones) if (z.startIdx > 0) byIdx.set(z.startIdx - 1, z);

    return {
      byIdx,
      det,
      zones:      zones.length,
      // La réserve, tenue ICI : le compte ne connaît que la poche. Elle est
      // dotée à la première bougie, quand api.withdraw existe.
      reserve:    0,
      amorce:     false,
      ignorees:   0,       // surventes tombées pendant une position ouverte
      refusees:   0,       // poche ou réserve insuffisante
      recharges:  0,
      retraits:   0,
      cramees:    0,
      finie:      false,
      annonce:    false,
      capital:    account.capital,
    };
  },

  onBar({ candles, bar, i, state, params, api }) {
    // ── Dotation de la réserve, une fois, à la première bougie jouée ────────
    if (!state.amorce) {
      state.amorce = true;
      const surplus = Math.max(0, api.account.balance - params.poche);
      state.reserve = api.withdraw(surplus, 'dotation de la réserve');
      api.log(
        `${state.zones} surventes RSIER (${state.det.htf}, RSI ${state.det.rsiPeriod} ≤ ${state.det.osLevel}) `
        + `— poche ${usd(params.poche)}, réserve ${usd(state.reserve)}`,
      );
      if (state.zones === 0) {
        api.log('Aucune surzone : vérifie que le motif RSIER est réglé sur « Survente » dans le panneau Patterns.');
      }

      // LE RÉGLAGE QUI DÉCIDE DU SIGNE, dit à voix haute quand il est laissé à
      // l'hypothèse la plus optimiste. Sur Boom 1000, une bougie de spike porte
      // 59 ticks comme toutes les autres et clôture à 2 % de son sommet : le
      // bond est UN tick, et un stop posé dedans est servi APRÈS le saut, pas au
      // prix demandé. Laisser 0 % ici, c'est backtester un stop qui n'existe pas.
      const cfg = api.account.cfg;
      if (cfg.slipPct === 0) {
        api.log(
          '⚠ Glissement du stop à 0 % : chaque stop est supposé servi au prix demandé. Sur un Boom, '
          + 'le spike est un tick unique — le stop est servi après le saut. Relance à 100 % avant de '
          + 'croire ce résultat, l’écart se compte en centaines de dollars.',
        );
      }
      if (cfg.spreadPts === 0) {
        api.log('⚠ Spread à 0 : le broker en écrit 1,45 point en médiane sur Boom 1000 (bars_m1.spread).');
      }
    }

    // ── Sortie en temps ────────────────────────────────────────────────────
    if (params.maxBarsHeld > 0) {
      for (const pos of api.positions) {
        if (i - pos.entryIndex >= params.maxBarsHeld) api.close(pos, 'temps');
      }
    }

    // ── Balayage de la poche dès qu'elle est libre ─────────────────────────
    // Fait ici plutôt qu'à l'entrée suivante : le surplus doit être hors du
    // compte pendant TOUT le temps où il n'y travaille pas, sinon il repousse
    // les stop outs d'une position qu'il n'a pas financée.
    if (api.positions.length === 0 && api.pending.length === 0) {
      const surplus = api.account.balance - params.poche;
      if (surplus > 1e-9) {
        state.reserve += api.withdraw(surplus, 'mise en réserve');
        state.retraits++;
      }
    }

    // ── Le bilan de caisse, à la dernière bougie ──────────────────────────
    // Aucune statistique du rapport ne porte la réserve : elle vit ici. Sans
    // cette ligne, un run se lirait sur le seul solde du broker, qui vaut la
    // poche à un dollar près du début à la fin.
    if (i >= candles.length - 1 && !state.bilan) {
      state.bilan = true;
      const a = api.account;
      api.log(
        `Bilan — poche ${usd(a.balance)} + réserve ${usd(state.reserve)} = ${usd(a.balance + state.reserve)} `
        + `(capital ${usd(state.capital)}) · ${state.recharges} recharges, ${state.retraits} retraits, `
        + `${state.cramees} poche(s) cramée(s) · ${state.ignorees} surventes ignorées (position en cours), `
        + `${state.refusees} refusées (poche insuffisante)`,
      );
    }

    // ── Une survente s'ouvre-t-elle à la bougie suivante ? ─────────────────
    const z = state.byIdx.get(i);
    if (!z || state.finie) return;

    if (api.positions.length > 0 || api.pending.length > 0) { state.ignorees++; return; }

    // Recharge de la poche depuis la réserve. C'est le seul moment où de
    // l'argent rentre : on ne recharge jamais une position en cours.
    const manque = params.poche - api.account.balance;
    if (manque > 1e-9) {
      if (api.account.balance <= 1e-9) state.cramees++;
      const pris = api.deposit(Math.min(manque, state.reserve), 'recharge de la poche');
      if (pris > 0) { state.reserve -= pris; state.recharges++; }
      // Réserve à sec et poche incomplète : la partie est finie, et on le DIT.
      // Continuer avec une poche entamée simulerait un compte qu'on n'a plus.
      if (pris < manque - 1e-9 && params.stopSiReserve) {
        state.finie = true;
        api.log(`Réserve épuisée le ${new Date(bar.time * 1000).toISOString().slice(0, 16)} — arrêt des entrées.`);
        return;
      }
    }

    const soldeDispo = api.account.balance;
    if (params.minPoche > 0 && soldeDispo < params.minPoche - 1e-9) { state.refusees++; return; }
    if (!(soldeDispo > 0)) { state.refusees++; return; }

    // ── La taille ─────────────────────────────────────────────────────────
    const pv = api.account.cfg.pointValue;
    let lots = params.lotMode === 'fixe'
      ? params.lotsFixes
      : params.risqueUsd / (params.slPts * pv);
    lots = api.normalizeLots(lots);
    if (!(lots > 0)) { state.refusees++; return; }

    // ── L'objectif ────────────────────────────────────────────────────────
    const ordre = { slPts: params.slPts, lots, tag: `RSI ${z.rsiStart?.toFixed(1) ?? ''}` };
    if (params.tpMode === 'rr')          ordre.rr    = params.rr;
    else if (params.tpMode === 'points') ordre.tpPts = params.tpPts;
    else                                 ordre.tpPts = params.tpUsd / (lots * pv);

    if (!state.annonce) {
      state.annonce = true;
      const risque = lots * params.slPts * pv;
      const gain   = lots * (ordre.tpPts ?? params.slPts * params.rr) * pv;
      api.log(
        `Taille : ${lots} lot(s) → le stop de ${params.slPts} pts coûte ${usd(risque)}, `
        + `l'objectif rapporte ${usd(gain)} (poche ${usd(params.poche)}).`,
      );
      if (params.lotMode === 'risque' && Math.abs(risque - params.risqueUsd) > 0.01) {
        api.log(
          `⚠ Risque demandé ${usd(params.risqueUsd)}, risque obtenu ${usd(risque)} : le lot a été `
          + `ramené au pas / au minimum du compte. C'est LUI qui fixe le risque réel.`,
        );
      }
      if (risque > params.poche) {
        api.log(
          `⚠ Le stop coûte plus que la poche (${usd(risque)} > ${usd(params.poche)}) : la position sera `
          + `liquidée AVANT son stop. La poche est le vrai stop.`,
        );
      }
    }

    api.sell(ordre);
  },

  // LE COMPTE EST À ZÉRO — la poche a été emportée, la réserve non. C'est le cas
  // que le montage entier existe pour rendre survivable : on recharge, et la
  // partie continue. Le faire ICI plutôt qu'à la prochaine surzone n'est pas un
  // détail : le moteur déclarerait la ruine à cette bougie-ci et s'arrêterait
  // avant même de nous redemander quoi que ce soit.
  onRuin({ state, api, bar, params }) {
    state.cramees++;
    const manque = params.poche - api.account.balance;
    const pris   = api.deposit(Math.min(manque, state.reserve), 'poche cramée — recharge');
    state.reserve -= pris;
    if (pris > 0) state.recharges++;

    const quand = new Date(bar.time * 1000).toISOString().slice(0, 16).replace('T', ' ');
    api.log(pris > 0
      ? `Poche cramée le ${quand} — rechargée de ${usd(pris)}, réserve ${usd(state.reserve)}`
      : `Poche cramée le ${quand} et réserve vide — ruine.`);
  },
};
