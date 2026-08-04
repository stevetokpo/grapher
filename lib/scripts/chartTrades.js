// Traduit les trades d'un script vers ce que le graphe sait peindre.
//
// `components/charts/TradesPrimitive.js` dessine déjà des positions — bande de
// risque, bande de gain, trajet entrée→sortie, stop initial en pointillé quand
// il a été déplacé. Elle est employée par le backtest et par quatre motifs. Un
// script n'a donc rien de neuf à faire dessiner : juste à parler la même langue.
//
// DEUX TRADUCTIONS ont un fond, le reste est du renommage :
//
//   • le RÉSULTAT. Un script compte en USD parce qu'il a un capital ; la
//     primitive veut des POINTS, et se sert de leur signe pour colorer le
//     trajet. Un trade dont le gain brut ne couvre pas ses frais est une PERTE,
//     et doit se peindre en rouge : on repasse donc par le net réel, en points,
//     plutôt que par `profitPoints` qui est brut.
//
//   • la CAUSE de sortie. La primitive ne connaît que quatre issues (tp, sl, be,
//     missed) ; un script en a d'autres — sortie au signal, en temps, liquidation
//     par le broker, solde de fin de données. Toutes celles-là deviennent
//     'other', qui se peint en gris : une issue qui n'est ni un stop ni un
//     objectif ne doit pas emprunter leur couleur.

const STATUS = { sl: 'sl', tp: 'tp', be: 'be' };

export function toChartTrades(trades = [], { pointValue = 1 } = {}) {
  const out = [];

  for (const t of trades) {
    if (t.entryTime == null || t.exitTime == null) continue;

    // USD par point pour CETTE position — c'est ce qui permet de revenir du
    // résultat net en dollars vers un résultat net en points.
    const usdPerPoint = t.lots * pointValue;
    const netPoints = usdPerPoint > 0 ? t.profitUsd / usdPerPoint : t.profitPoints;

    out.push({
      id:           t.id,
      direction:    t.side,          // 'BUY' | 'SELL'
      entryTime:    t.entryTime,
      entryPrice:   t.entryPrice,
      exitTime:     t.exitTime,
      exitPrice:    t.exitPrice,
      sl:           t.sl,            // stop EN VIGUEUR à la sortie
      tp:           t.tp,
      risk0:        t.risk0,         // sert à retracer le stop d'origine
      profitPoints: t.profitPoints,  // brut
      netPoints,                     // net — c'est lui qui décide de la couleur
      profitR:      t.profitR,
      status:       STATUS[t.reason] ?? 'other',
      exitReason:   t.reason,
    });
  }

  return out;
}
