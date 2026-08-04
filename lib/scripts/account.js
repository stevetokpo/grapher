// Le COMPTE — le seul objet du dépôt qui connaisse un capital.
//
// Tout le reste de la plateforme raisonne en POINTS et en R : le lot y est fixe,
// implicite, et la question « est-ce que je saute » ne se pose jamais. Un script,
// lui, part d'un capital, dimensionne ses lots dessus, immobilise de la marge,
// et peut se faire couper. C'est cette différence-là que ce fichier porte, et
// c'est la seule raison pour laquelle il existe à côté de lib/backtest.
//
// UNITÉS — tout est en points de prix ; l'AFFICHAGE dit USD.
//   gain d'une position = points gagnés × lots × pointValue
//   pointValue = 1 par défaut : un point de prix, un lot → 1 USD. Le capital
//   fourni « en points » est alors exactement le solde en USD affiché. Changer
//   pointValue ne change que l'échelle monétaire, jamais les points.
//
// LA MARGE, telle que la voit un broker :
//   margeUtilisée = Σ lots × marginPerLot          (immobilisée, pas dépensée)
//   equity        = solde + flottant des positions ouvertes
//   niveau        = equity / margeUtilisée × 100   (null si rien n'est ouvert)
//   • niveau < marginCallLevel  → APPEL DE MARGE. Compté, signalé, mais aucune
//     position n'est touchée : c'est un avertissement, pas une liquidation.
//   • niveau < stopOutLevel     → STOP OUT. Le broker ferme la position la PLUS
//     PERDANTE, puis recommence tant que le niveau reste sous le seuil. C'est
//     l'ordre réel des choses, et c'est pourquoi un stop out en ferme parfois
//     plusieurs d'affilée.
//   • equity ≤ 0                → RUINE. Le script s'arrête là ; ce qui suit
//     n'aurait aucun sens à simuler.
//
// LES COÛTS sont portés par la position dès son ouverture et comptés dans le
// flottant : spread (aller-retour, en points) et commission (USD par lot). Une
// position vaut donc son coût EN MOINS à la seconde où elle s'ouvre — sans quoi
// l'équité mentirait juste assez pour repousser un stop out.

export const ACCOUNT_DEFAULTS = {
  capital:          10000,  // capital de départ, en points (affiché USD)
  pointValue:       1,      // USD par point et par lot
  marginPerLot:     100,    // USD immobilisés par lot ouvert
  spreadPts:        0,      // coût aller-retour, en points, par position
  commissionPerLot: 0,      // USD par lot, aller-retour
  marginCallLevel:  100,    // % — avertissement
  stopOutLevel:     50,     // % — liquidation forcée
  minLot:           0.01,
  maxLot:           100,
  lotStep:          0.01,
};

export const ACCOUNT_FIELDS = [
  { kind: 'number', key: 'capital', label: 'Capital (USD)', min: 1, max: 100000000, step: 100 },
  { kind: 'row', fields: [
    { kind: 'number', key: 'pointValue',   label: 'USD / point / lot', min: 0.0001, max: 10000, step: 0.1 },
    { kind: 'number', key: 'marginPerLot', label: 'Marge / lot (USD)', min: 0,      max: 1000000, step: 10 },
  ] },
  { kind: 'hint', text:
    "Le capital est fourni en POINTS — avec « USD / point / lot » à 1, un point vaut un dollar et "
    + "les deux unités se confondent. La marge par lot est ce que le broker immobilise : c'est elle "
    + "qui décide du nombre de positions tenables en même temps, et donc des appels de marge." },
  { kind: 'row', fields: [
    { kind: 'number', key: 'spreadPts',        label: 'Spread (points)',   min: 0, max: 10000, step: 0.1 },
    { kind: 'number', key: 'commissionPerLot', label: 'Commission / lot',  min: 0, max: 10000, step: 0.1 },
  ] },
  { kind: 'row', fields: [
    { kind: 'number', key: 'marginCallLevel', label: 'Appel de marge (%)', min: 0, max: 1000, step: 5 },
    { kind: 'number', key: 'stopOutLevel',    label: 'Stop out (%)',       min: 0, max: 1000, step: 5 },
  ] },
  { kind: 'hint', text:
    "Sous le niveau d'appel de marge, l'événement est compté sans rien fermer. Sous le stop out, la "
    + "position la plus perdante est liquidée, et on recommence tant qu'on reste sous le seuil." },
  { kind: 'row', fields: [
    { kind: 'number', key: 'minLot',  label: 'Lot min', min: 0.001, max: 1000, step: 0.01 },
    { kind: 'number', key: 'maxLot',  label: 'Lot max', min: 0.001, max: 100000, step: 1 },
  ] },
  { kind: 'number', key: 'lotStep', label: 'Pas de lot', min: 0.001, max: 100, step: 0.001 },
];

export function sanitizeAccount(raw = {}) {
  const out = { ...ACCOUNT_DEFAULTS };
  for (const key of Object.keys(ACCOUNT_DEFAULTS)) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  // Un stop out AU-DESSUS de l'appel de marge liquiderait avant d'avertir : on
  // remet l'ordre plutôt que de rejeter, comme le fait sanitizeParams ailleurs.
  if (out.stopOutLevel > out.marginCallLevel) out.stopOutLevel = out.marginCallLevel;
  if (out.maxLot < out.minLot) out.maxLot = out.minLot;
  if (!(out.lotStep > 0)) out.lotStep = ACCOUNT_DEFAULTS.lotStep;
  if (!(out.capital > 0)) out.capital = ACCOUNT_DEFAULTS.capital;
  return out;
}

// Coût d'aller-retour d'une position, en USD. Porté dès l'ouverture.
function tradeCost(cfg, lots) {
  return cfg.spreadPts * lots * cfg.pointValue + cfg.commissionPerLot * lots;
}

export class Account {
  constructor(config = {}) {
    this.cfg     = sanitizeAccount(config);
    this.capital = this.cfg.capital;
    this.balance = this.cfg.capital;

    this.positions = [];   // ouvertes
    this.trades    = [];   // fermées, dans l'ordre de sortie
    this.events    = [];   // appels de marge, stop outs, refus, ruine

    // Suivi — l'essentiel de ce qu'on saura raconter à la fin.
    this.equity          = this.cfg.capital;
    this.usedMargin      = 0;
    this.peakEquity      = this.cfg.capital;
    this.maxDrawdown     = 0;     // USD, sur l'équité
    this.maxDrawdownPct  = 0;
    this.maxUsedMargin   = 0;
    this.minMarginLevel  = null;  // % — le pire moment traversé
    // Un appel de marge compte un ÉPISODE, pas une bougie : rester dix bougies
    // sous le seuil, c'est un appel de marge, pas dix. Le nombre de bougies
    // passées dessous est compté à part — c'est lui qui dit combien de temps
    // le compte est resté en danger.
    this.marginCalls     = 0;
    this.marginCallBars  = 0;
    this.inMarginCall    = false;
    this.stopOuts        = 0;
    this.rejected        = 0;     // ordres refusés faute de marge libre
    this.totalLots       = 0;
    this.totalCosts      = 0;     // spread + commissions payés, USD
    this.ruined          = false;
    this.ruinTime        = null;

    this._nextId = 1;
  }

  // ── Lecture ───────────────────────────────────────────────────────────────
  get freeMargin()  { return this.equity - this.usedMargin; }
  get marginLevel() { return this.usedMargin > 0 ? (this.equity / this.usedMargin) * 100 : null; }
  get floating()    { return this.equity - this.balance; }

  // Instantané passé aux scripts : lecture seule, jamais l'objet vivant.
  snapshot() {
    return {
      capital:     this.capital,
      balance:     this.balance,
      equity:      this.equity,
      usedMargin:  this.usedMargin,
      freeMargin:  this.freeMargin,
      marginLevel: this.marginLevel,
      floating:    this.floating,
      openCount:   this.positions.length,
      ruined:      this.ruined,
    };
  }

  // ── Lots ──────────────────────────────────────────────────────────────────
  normalizeLots(lots) {
    const { minLot, maxLot, lotStep } = this.cfg;
    if (!Number.isFinite(lots) || lots <= 0) return 0;
    const stepped = Math.floor(lots / lotStep + 1e-9) * lotStep;
    const clamped = Math.min(maxLot, Math.max(minLot, stepped));
    // Le pas de lot est décimal : sans arrondi, 0.1 + 0.2 traîne partout ensuite.
    return +clamped.toFixed(6);
  }

  // Lots pour risquer riskPct % de l'ÉQUITÉ courante sur une distance de stop
  // donnée en points. C'est la primitive de dimensionnement : un script qui veut
  // risquer 1 % par trade n'a pas à refaire ce calcul, ni à se tromper dessus.
  lotsForRisk(riskPct, stopPoints) {
    if (!(riskPct > 0) || !(stopPoints > 0)) return 0;
    const riskUsd = this.equity * (riskPct / 100);
    return this.normalizeLots(riskUsd / (stopPoints * this.cfg.pointValue));
  }

  marginFor(lots) { return lots * this.cfg.marginPerLot; }
  canAfford(lots) { return this.marginFor(lots) <= this.freeMargin; }

  // ── Ouverture / fermeture ─────────────────────────────────────────────────
  // Retourne la position, ou null si le compte n'a pas la marge libre. Un refus
  // est COMPTÉ : c'est un résultat de la simulation, pas une erreur silencieuse.
  open({ side, lots, price, time, index, sl = null, tp = null, tag = null }) {
    const normLots = this.normalizeLots(lots);
    if (normLots <= 0) {
      this.rejected++;
      this.events.push({ type: 'rejected', time, index, reason: 'lots', lots });
      return null;
    }
    const margin = this.marginFor(normLots);
    if (margin > this.freeMargin) {
      this.rejected++;
      this.events.push({
        type: 'rejected', time, index, reason: 'margin',
        lots: normLots, required: margin, free: this.freeMargin,
      });
      return null;
    }

    const cost = tradeCost(this.cfg, normLots);
    const pos = {
      id:        this._nextId++,
      side,                       // 'BUY' | 'SELL'
      lots:      normLots,
      entryPrice: price,
      entryTime:  time,
      entryIndex: index,
      sl, tp,
      sl0:       sl,              // stop d'origine — définit le risque initial
      tag,
      margin,
      cost,
      maxFavorPts:  0,            // MFE, en points
      maxAdversePts: 0,           // MAE, en points
      beMoved:   false,
    };

    this.positions.push(pos);
    this.usedMargin += margin;
    this.totalLots  += normLots;
    if (this.usedMargin > this.maxUsedMargin) this.maxUsedMargin = this.usedMargin;
    return pos;
  }

  close(pos, price, time, index, reason = 'close') {
    const i = this.positions.indexOf(pos);
    if (i === -1) return null;

    const dir          = pos.side === 'BUY' ? 1 : -1;
    const profitPoints = (price - pos.entryPrice) * dir;
    const gross        = profitPoints * pos.lots * this.cfg.pointValue;
    const net          = gross - pos.cost;

    this.positions.splice(i, 1);
    this.usedMargin -= pos.margin;
    if (this.usedMargin < 1e-9) this.usedMargin = 0;
    this.balance    += net;
    this.totalCosts += pos.cost;

    const risk0 = pos.sl0 != null ? Math.abs(pos.entryPrice - pos.sl0) : null;
    const trade = {
      id:           pos.id,
      side:         pos.side,
      lots:         pos.lots,
      tag:          pos.tag,
      entryTime:    pos.entryTime,
      entryIndex:   pos.entryIndex,
      entryPrice:   pos.entryPrice,
      exitTime:     time,
      exitIndex:    index,
      exitPrice:    price,
      bars:         index - pos.entryIndex,
      sl:           pos.sl,
      sl0:          pos.sl0,
      tp:           pos.tp,
      beMoved:      pos.beMoved,
      reason,                                    // 'sl'|'tp'|'be'|'close'|'stopout'|'end'
      profitPoints,
      grossUsd:     gross,
      costUsd:      pos.cost,
      profitUsd:    net,
      profitR:      risk0 > 0 ? profitPoints / risk0 : null,
      risk0,
      maxFavorPts:   pos.maxFavorPts,
      maxAdversePts: pos.maxAdversePts,
      balanceAfter: this.balance,
    };
    this.trades.push(trade);
    return trade;
  }

  // ── Valorisation ──────────────────────────────────────────────────────────
  // Flottant d'une position à un prix donné, coûts déduits.
  floatingOf(pos, price) {
    const dir = pos.side === 'BUY' ? 1 : -1;
    return (price - pos.entryPrice) * dir * pos.lots * this.cfg.pointValue - pos.cost;
  }

  equityAt(price) {
    let eq = this.balance;
    for (const p of this.positions) eq += this.floatingOf(p, price);
    return eq;
  }

  // Valorise le compte au prix donné et enregistre pic / drawdown / pire niveau
  // de marge. Appelée à la clôture de chaque bougie, et au PIRE prix de chaque
  // bougie pour la surveillance de marge (cf. engine.js).
  mark(price) {
    this.equity = this.equityAt(price);
    if (this.equity > this.peakEquity) this.peakEquity = this.equity;

    const dd = this.peakEquity - this.equity;
    if (dd > this.maxDrawdown) {
      this.maxDrawdown    = dd;
      this.maxDrawdownPct = this.peakEquity > 0 ? (dd / this.peakEquity) * 100 : 0;
    }

    const level = this.marginLevel;
    if (level != null && (this.minMarginLevel == null || level < this.minMarginLevel)) {
      this.minMarginLevel = level;
    }
    return this.equity;
  }
}
