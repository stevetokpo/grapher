// Détection des FVG et des iFVG pour le ticker.
//
// ── FVG (Fair Value Gap) ─────────────────────────────────────────────────────
// Trois bougies a · b · c. L'impulsion b va si vite que la mèche de a et celle
// de c ne se recouvrent pas : il reste entre elles une bande de prix où AUCUNE
// transaction n'a eu lieu à l'échelle de ces trois bougies.
//
//   haussier : c.low  > a.high   →  boîte [a.high, c.low]
//   baissier : c.high < a.low    →  boîte [c.high, a.low]
//
// Même inégalité que le reste de la plateforme (lib/xfvg/detect.js : le gap
// haussier y vaut `c.low - a.high`) — deux vues du même marché ne doivent pas
// se contredire sur la définition du motif.
//
// ── iFVG (FVG inversé) ───────────────────────────────────────────────────────
// Un FVG cesse d'être une zone de soutien le jour où le prix le TRAVERSE pour
// de bon. Il ne disparaît pas pour autant : il change de camp. Un FVG haussier
// dont une bougie CLÔTURE sous son bord bas devient une zone de résistance —
// c'est l'iFVG.
//
// La clôture, et pas la mèche : une mèche qui dépasse est un test, une clôture
// est une décision. Prendre la mèche ferait basculer le motif au premier
// balayage de liquidité, c'est-à-dire exactement quand il ne faut pas.
//
// Une zone rendue par ce module :
//   { id, side: 'bull' | 'bear', kind: 'fvg' | 'ifvg',
//     top, bottom, fromMs, toMs, filled }
//   Un motif inversé produit DEUX zones : le FVG d'origine, borné à l'instant
//   de l'inversion, puis l'iFVG qui prend la suite. C'est ce qui se lit sur le
//   graphe : la zone a vécu, puis elle a changé de sens.

// Les bougies du ticker : { time (secondes), open, high, low, close }.
// `time` est en SECONDES ; les zones sortent en millisecondes, comme tout ce
// qui est ancré dans le temps ici (voir hooks/useZones.js).
// Nombre de motifs RENDUS, en partant du plus récent. Ce n'est pas une limite
// de calcul mais une limite de LECTURE : au-delà d'une douzaine, les boîtes se
// recouvrent et le graphe ne montre plus rien. Un motif vieux de deux cents
// bougies, coupé après son étirement, n'apprend d'ailleurs plus rien.
const LIMIT_MAX = 60;

export const FVG_DEFAULTS = {
  showFvg:    true,
  showIfvg:   true,
  hideFilled: false,   // masquer les FVG déjà comblés (mèche entrée dedans)
  limit:      12,      // motifs affichés, du plus récent au plus ancien
  // Étirement maximal à droite, en BOUGIES. Une zone tirée jusqu'au bord droit
  // finit par barrer tout le graphe et à prétendre valoir encore alors que le
  // marché est passé à autre chose depuis longtemps. On la coupe net, comme le
  // fait déjà le xFVG de la plateforme avec son extLen.
  extLen:     10,
};

export const EXT_MIN = 1;
export const EXT_MAX = 500;
export const LIMIT_CAP = LIMIT_MAX;

export function detectFvg(bars, opts = {}) {
  const { showFvg, showIfvg, hideFilled, extLen, limit } = { ...FVG_DEFAULTS, ...opts };
  const cap = Math.max(1, Math.min(LIMIT_MAX, Math.trunc(limit) || FVG_DEFAULTS.limit));
  const ext = Math.max(EXT_MIN, Math.min(EXT_MAX, Math.trunc(extLen) || FVG_DEFAULTS.extLen));
  const out = [];
  if (!Array.isArray(bars) || bars.length < 3) return out;

  const n = bars.length;
  // Fin d'étirement : `depuis` + `ext` bougies, sans dépasser la dernière
  // chargée. C'est un nombre de BOUGIES, pas une durée — sur un pas de temps
  // régulier les deux se confondent, mais c'est la bougie qui fait foi.
  const endMs = (from) => bars[Math.min(n - 1, from + ext)].time * 1000;

  // On remonte depuis la fin : les motifs récents sont ceux qu'on regarde, et
  // s'arrêter au plafond garde le coût borné sur une longue série.
  // On remonte depuis la fin et on s'arrête au plafond : ce sont les motifs
  // RÉCENTS qu'on lit. Un motif inversé compte pour un, même s'il rend deux
  // boîtes — c'est une seule histoire.
  let kept = 0;
  for (let i = n - 1; i >= 2 && kept < cap; i--) {
    const a = bars[i - 2], c = bars[i];

    let side = null, top = 0, bottom = 0;
    if (c.low > a.high)       { side = 'bull'; bottom = a.high;  top = c.low; }
    else if (c.high < a.low)  { side = 'bear'; bottom = c.high;  top = a.low; }
    else continue;

    const fromMs = a.time * 1000;

    // Parcours vers l'avant : on cherche le premier contact (comblement) et la
    // première CLÔTURE au-delà du bord opposé (inversion).
    let filled = false;
    let invertIdx = null;
    for (let j = i + 1; j < n; j++) {
      const b = bars[j];
      if (!filled) {
        // Le prix est revenu dans la bande — le déséquilibre a été payé.
        if (side === 'bull' ? b.low <= top : b.high >= bottom) filled = true;
      }
      const broken = side === 'bull' ? b.close < bottom : b.close > top;
      if (broken) { invertIdx = j; break; }
    }

    if (invertIdx == null) {
      if (showFvg && !(hideFilled && filled)) {
        kept++;
        out.push({
          id: `fvg-${a.time}-${side}`,
          side, kind: 'fvg', top, bottom,
          fromMs, toMs: endMs(i), filled,
        });
      }
      continue;
    }

    // Le motif a vécu puis basculé : on garde les deux moitiés de son histoire.
    // L'inversion COUPE le FVG là où elle survient, même si son étirement
    // n'était pas épuisé — un motif retourné a cessé d'être ce qu'il était.
    const invertMs = bars[invertIdx].time * 1000;
    kept++;
    if (showFvg && !(hideFilled && filled)) {
      out.push({
        id: `fvg-${a.time}-${side}`,
        side, kind: 'fvg', top, bottom,
        fromMs, toMs: Math.min(invertMs, endMs(i)), filled,
      });
    }
    if (showIfvg) {
      out.push({
        id: `ifvg-${a.time}-${side}`,
        // Le sens s'INVERSE : un FVG haussier traversé devient une résistance.
        side: side === 'bull' ? 'bear' : 'bull',
        kind: 'ifvg', top, bottom,
        // L'iFVG repart de l'inversion avec son PROPRE étirement : c'est un
        // motif neuf, pas la suite du précédent.
        fromMs: invertMs, toMs: endMs(invertIdx), filled: false,
      });
    }
  }

  return out;
}
