// Twins Bars — réglages : valeurs par défaut d'un côté, description du
// formulaire de l'autre. Même contrat que lib/liq/params.js et lib/rev/params.js.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

// ── Détection ────────────────────────────────────────────────────────────────
// Les VALEURS sont celles que le motif avait quand son formulaire était écrit à
// la main dans components/PatternPanel.js : le nombre de signaux est donc
// inchangé. Les NOMS non plus n'ont pas bougé — la stratégie de backtest
// lib/backtest/strategies/twinsBars.js passe les mêmes clés.
export const DETECT_DEFAULTS = {
  direction:       'both', // sens de la SECONDE bougie, celle qui retourne le marché
  atrPeriod:       7,      // 0 = filtre de taille absolue éteint
  atrMult:         1.6,    // les deux corps > ATR × ce multiple
  similarityRatio: 0.7,    // min(corps) / max(corps) — 1 = jumelles parfaites
  // BALAYAGE DU SWING PRÉCÉDENT — une OPTION, éteinte par défaut. Allumée, la
  // paire doit avoir dépassé la dernière structure d'en face : le plus HAUT des
  // deux au-dessus du dernier swing haut pour une paire HB (vente), le plus BAS
  // sous le dernier swing bas pour une BH (achat). Éteinte, le motif est
  // exactement celui d'avant — c'est ce qui permet de mesurer ce que la
  // condition apporte au lieu de la supposer bonne.
  swingFilter:     false,
  swingBars:       2,      // bougies de chaque côté qui confirment un swing (même définition que l'indicateur SWING)
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit lib/patternPositions.js, via ./positions.js.
//
// ENTRÉE AU MARCHÉ, ET RIEN D'AUTRE. Les autres motifs de la famille (liq, rev)
// tracent une BANDE de prix et peuvent y poser un ordre en attente. Twins Bars
// ne trace rien de tel : c'est un repère, pas une zone — il n'y a aucun bord où
// attendre un retour. `entryMode` est donc figé sur 'market' : il n'a pas de
// champ dans le formulaire, et ./positions.js le réimpose de toute façon. Le
// réglage reste ici parce que le rapport doit dire à quel prix on est entré.
export const POSITION_DEFAULTS = {
  // 'marker' = les flèches seules | 'position' = les trades | 'both'.
  // Défaut sur 'both' : le motif était un simple repère, il gagne des positions —
  // un défaut qui les cacherait rendrait invisibles le moniteur ET le bouton de
  // rapport, sans rien dire.
  display:     'both',
  entryMode:   'market',
  // OÙ VA LE TP, et s'il dépend du stop :
  //   'rr'     — TP = entrée ± rr × risque. L'objectif suit le stop : un motif
  //              large donne un TP large. C'est le défaut de la famille.
  //   'points' — TP = entrée ± tpPts. L'objectif est DÉTACHÉ du stop, comme
  //              celui du rFVG. Avec un stop en points, les deux bouts sont
  //              fixes et le RR n'est plus un réglage mais un résultat.
  tpMode:      'rr',
  rr:          2,          // mode 'rr' : TP = entrée ± rr × risque
  tpPts:       10,         // mode 'points' : la distance du TP, depuis l'entrée
  // D'où vient le stop, et donc le R :
  //   'structure' — sous/sur l'extrême des DEUX bougies du motif. Le risque
  //                 varie d'une position à l'autre, au gré de la taille de la
  //                 paire — et cette taille est justement filtrée par l'ATR.
  //   'points'    — une distance FIXE depuis l'entrée. Le risque devient
  //                 constant, et compter en points ou en R revient au même.
  slMode:      'structure',
  slMarginPts: 0,          // mode 'structure' : marge sous/sur l'extrême. 0 = pile dessus
  slPts:       10,         // mode 'points' : la distance, qui EST le R
  spreadPts:   0,          // coût de l'aller-retour, déduit de chaque position clôturée
  beTriggerR:  0,          // BE — seuil en R. 0 = pas de break-even
  beLevelR:    0,          // BE — où va le stop, en R depuis l'entrée. 0 = à l'entrée
  uniqueTrade: false,      // une seule position à la fois
  skipAfterTp: 0,          // repos : combien de signaux sauter après un gain
  // LE DÛ — combien de pertes non remboursées arment le remboursement. 0 = off.
  // Au-delà de ce seuil, la position suivante vise le remboursement au lieu de
  // son vrai TP, jusqu'à ce que l'ardoise soit soldée.
  dueAfterSl:  0,
  // Ce qu'elle vise, justement :
  //   'full' — toute l'ardoise d'un coup. Elle grossit, l'objectif s'éloigne.
  //   'step' — par bonds de `dueAfterSl` × la perte moyenne encore due, soit la
  //            taille de ce qui a armé le dû. L'objectif reste atteignable, et
  //            on rembourse en plusieurs fois.
  dueMode:     'full',
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Le motif se marque d'une FLÈCHE, pas d'une bande : il désigne une bougie, pas
// un prix où revenir.
export const STYLE_DEFAULTS = {
  bullColor:  '#26A69A',
  bearColor:  '#EF5350',
  markerSize: 1,
  showLabel:  true,
};

export const TWINS_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

// Détection + position : le simulateur a besoin des deux, puisqu'il redétecte
// les motifs avant de les jouer.
export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
  // Non négociable, même si un réglage enregistré disait autre chose : le motif
  // n'a pas de zone, il n'y a nulle part où poser un ordre en attente.
  entryMode: 'market',
});

export function styleOptions(pat = {}) {
  return {
    bullColor:  pat.bullColor  ?? STYLE_DEFAULTS.bullColor,
    bearColor:  pat.bearColor  ?? STYLE_DEFAULTS.bearColor,
    markerSize: pat.markerSize ?? STYLE_DEFAULTS.markerSize,
    showLabel:  pat.showLabel !== false,
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Rendu par <SchemaForm> (components/PatternPanel.js).
// Types : 'segmented' | 'number' | 'toggle' | 'color' | 'row' | 'divider' | 'hint'.
// `when: v => …` masque un champ selon les réglages courants.
export const FIELDS = [
  { kind: 'hint', text:
    "Deux bougies COLLÉES et de sens opposés, toutes deux à corps plein (corps ≥ mèche haute + "
    + "mèche basse) et de taille voisine. Le sens du signal est celui de la SECONDE : baissière "
    + "puis haussière = achat, haussière puis baissière = vente." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Achat' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Vente' },
  ] },

  { kind: 'divider', label: 'Les deux jumelles' },

  { kind: 'number', key: 'similarityRatio', label: 'Ratio de similarité (1 = identiques)',
    min: 0.1, max: 1, step: 0.05 },
  { kind: 'hint', text:
    "min(corps) / max(corps) entre les deux bougies. C'est ce qui fait des JUMELLES plutôt qu'une "
    + "grande suivie d'une petite : à 0,7, la plus courte fait au moins 70 % de la plus longue." },

  { kind: 'row', fields: [
    { kind: 'number', key: 'atrPeriod', label: 'Période ATR (0 = off)',   min: 0, max: 200, step: 1 },
    { kind: 'number', key: 'atrMult',   label: 'Corps > ATR ×',           min: 0, max: 20,  step: 0.1 },
  ] },
  { kind: 'hint', text:
    "Les DEUX corps doivent dépasser ce multiple de l'ATR. La fenêtre d'ATR se termine juste AVANT "
    + "la paire, sinon elle contiendrait déjà les bougies qu'on juge. C'est le principal étrangleur "
    + "de signaux du motif : période à 0 = filtre éteint, et beaucoup plus de détections." },

  { kind: 'divider', label: 'Balayage du swing précédent' },

  { kind: 'toggle', key: 'swingFilter', label: 'Exiger le dépassement du swing' },
  { kind: 'hint', text:
    "Option, ÉTEINTE par défaut. Activée, la paire doit être allée CHERCHER la dernière structure "
    + "d'en face et la dépasser : une paire haussière→baissière (vente) doit passer au-dessus du "
    + "dernier swing HAUT, une paire baissière→haussière (achat) doit passer sous le dernier swing "
    + "BAS. C'est l'extrême de la paire qui est jugé, mèches comprises — le même prix que celui qui "
    + "porte le stop. Éteinte, le motif est exactement celui d'avant : compare les deux plutôt que "
    + "de supposer que la condition aide." },
  { kind: 'number', key: 'swingBars', label: 'Bougies g/d du swing', min: 1, max: 50, step: 1,
    when: v => v.swingFilter === true },
  { kind: 'hint', when: v => v.swingFilter === true, text:
    "2 = un swing confirmé par 2 bougies avant et 2 après, strictement au-delà — la définition de "
    + "l'indicateur SWING et du stop de swing, à l'identique. Plus haut = des structures plus rares, "
    + "donc plus marquées, et moins de paires retenues. C'est LE swing précédent qui est testé, pas "
    + "« l'un des précédents » : celui formé par la paire elle-même ne compte jamais, et celui qui "
    + "n'était pas encore confirmé à la clôture de la paire non plus — sans quoi on entrerait sur "
    + "une structure venue du futur. Sans swing précédent connu, la paire est écartée." },

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'marker',   label: 'Repère' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => v.display === 'marker', text:
    "⚠ En « Repère », aucune position n'est simulée : ni le moniteur en haut à gauche du graphe, "
    + "ni le bouton de téléchargement du rapport n'apparaissent. Passe sur « Position » ou "
    + "« Les deux » pour les retrouver." },
  { kind: 'hint', when: v => v.display !== 'marker', text:
    "Entrée AU MARCHÉ à l'ouverture de la bougie qui suit la seconde jumelle — le motif n'est connu "
    + "qu'à sa clôture, c'est le premier prix disponible ensuite. Achat sur jumelles haussières, "
    + "vente sur baissières. Il n'y a pas de mode « retour dans la zone » ici : le motif désigne une "
    + "bougie, pas une bande où attendre. Une position est donc toujours prise, aucun signal n'est "
    + "raté." },

  { kind: 'segmented', key: 'slMode', label: 'Origine du stop', when: v => v.display !== 'marker', options: [
    { value: 'structure', label: 'Extrêmes du motif' },
    { value: 'points',    label: 'Distance fixe' },
  ] },
  { kind: 'number', key: 'slPts', label: 'Distance du SL (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'marker' && v.slMode === 'points' },
  { kind: 'number', key: 'slMarginPts', label: 'Marge du SL (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'marker' && v.slMode !== 'points' },
  { kind: 'hint', when: v => v.display !== 'marker' && v.slMode === 'structure', text:
    "Le stop va sous le plus BAS des DEUX bougies (au-dessus du plus HAUT en vente), moins la "
    + "marge. Le risque suit donc la taille de la paire et varie d'une position à l'autre — c'est ce "
    + "qui oblige à lire les gains en POINTS plutôt qu'en R, et à comparer le winrate au seuil de "
    + "rentabilité RÉALISÉ." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.slMode === 'points', text:
    "Le stop est à distance fixe de l'entrée : le risque devient CONSTANT. La marge ne sert plus — "
    + "elle ne concerne que les extrêmes du motif." },

  { kind: 'segmented', key: 'tpMode', label: 'Objectif du TP', when: v => v.display !== 'marker', options: [
    { value: 'rr',     label: 'RR du stop' },
    { value: 'points', label: 'Distance fixe' },
  ] },
  { kind: 'number', key: 'rr', label: 'RR du TP', min: 0.1, max: 50, step: 0.1,
    when: v => v.display !== 'marker' && (v.tpMode ?? 'rr') === 'rr' },
  { kind: 'number', key: 'tpPts', label: 'Distance du TP (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'marker' && v.tpMode === 'points' },
  { kind: 'hint', when: v => v.display !== 'marker' && (v.tpMode ?? 'rr') === 'rr', text:
    "TP = entrée ± RR × |entrée − stop| : l'objectif est ATTACHÉ au stop, une paire large donne un "
    + "TP large. Le RR est constant, le TP en points ne l'est pas — sauf si le stop est lui aussi en "
    + "distance fixe, auquel cas les deux le deviennent." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.tpMode === 'points', text:
    "TP à distance FIXE de l'entrée, indépendamment du stop — comme le rFVG. Les deux bouts se "
    + "règlent alors séparément : avec un stop structurel, c'est le RR qui varie d'une position à "
    + "l'autre et devient un résultat plutôt qu'un réglage ; le rapport le dit position par "
    + "position (profitR), et le moniteur donne le seuil de rentabilité RÉALISÉ." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.tpMode === 'points' && v.slMode === 'points', text:
    "SL et TP tous deux en distance fixe : le risque et l'objectif sont constants, le RR redevient "
    + "un simple rapport entre les deux, et le seuil de rentabilité est le 1/(1+RR) des manuels." },

  { kind: 'number', key: 'spreadPts', label: 'Spread (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'marker' },
  { kind: 'hint', when: v => v.display !== 'marker', text:
    "Le spread est le coût de l'aller-retour, déduit de chaque position clôturée : profitPoints "
    + "reste le brut, netPoints le réel." },

  { kind: 'row', when: v => v.display !== 'marker', fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'hint', when: v => v.display !== 'marker' && v.beTriggerR > 0, text:
    "Dès qu'une bougie avance de SEUIL × risque dans le sens de la position, le stop se déplace à "
    + "entrée ± BLOCAGE × risque, et n'y bouge plus jamais : c'est un déplacement unique, pas un "
    + "stop suiveur. Blocage à 0 = stop à l'entrée (le vrai break-even) ; 0,5 = un demi-R sécurisé ; "
    + "négatif = on réduit la perte sans l'annuler. Le stop déplacé ne peut jamais ÉLARGIR le "
    + "risque. Anti-anticipation : il ne prend effet qu'à la CLÔTURE de la bougie qui l'a armé. "
    + "Sortie sur ce stop = statut « be »." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.beTriggerR > 0
      && (v.tpMode ?? 'rr') === 'rr' && v.beTriggerR >= (v.rr ?? 2), text:
    "⚠ Le seuil est au-dessus du RR du TP : le TP sera toujours touché avant, et le BE ne s'armera "
    + "jamais. Descends le seuil sous le RR pour qu'il serve." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.beTriggerR > 0 && v.tpMode === 'points', text:
    "Le seuil reste en R alors que le TP est en points : le risque variant d'une position à l'autre, "
    + "il n'y a pas de seuil qui soit « au-dessus du TP » une fois pour toutes. C'est voulu — le BE "
    + "se règle sur le risque, qui existe toujours." },

  { kind: 'number', key: 'dueAfterSl', label: 'Dû — seuil (pertes non remboursées, 0 = off)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'marker' },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0, text:
    "REMBOURSER AVANT DE GAGNER. Chaque position clôturée dans le rouge laisse sa perte sur une "
    + "ardoise ; chaque gain la rembourse en commençant par la plus ANCIENNE. Dès que l'ardoise "
    + "compte ce nombre de pertes, la position suivante vise la SOMME de l'ardoise au lieu de son "
    + "vrai TP — et elle la vise même si c'est plus PRÈS que son objectif normal. Une fois remboursé, "
    + "le motif repart sur son vrai TP et les pertes soldées ne sont plus dues." },
  { kind: 'segmented', key: 'dueMode', label: 'Remboursement',
    when: v => v.display !== 'marker' && v.dueAfterSl > 0, options: [
      { value: 'full', label: "Tout d'un coup" },
      { value: 'step', label: 'Par bonds' },
    ] },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0 && v.dueMode === 'step', text:
    "Par BONDS de « seuil × perte moyenne encore due » — la taille exacte de ce qui a armé le dû. "
    + "Au moment de l'armement c'est toute l'ardoise ; ensuite, si elle a grossi, c'en est une "
    + "fraction, et il faudra plusieurs remboursements. L'idée : un objectif qui garde la même "
    + "taille au lieu de fuir avec l'ardoise. Exemple à seuil 5 et pertes de 10 points — 5 pertes "
    + "en attente : objectif 50, comme en « tout d'un coup » ; 10 pertes en attente : objectif 50 "
    + "quand même, et il en restera 50 à devoir." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0 && v.dueMode !== 'step', text:
    "Tout d'un coup : l'objectif vaut l'ardoise ENTIÈRE. Plus elle grossit, plus il s'éloigne — au "
    + "bout d'une longue série il peut devenir hors d'atteinte, et un objectif qu'on n'atteint pas "
    + "ne rembourse rien. « Par bonds » existe pour ça." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0, text:
    "Le dû se compte en points NETS : une sortie au break-even qui finit sous zéro (le spread) est "
    + "une perte et compte dans le seuil. Conséquence à connaître — avec un spread, rembourser ne "
    + "solde jamais tout à fait : le gain qui atteint le dû paie lui aussi son aller-retour, et il "
    + "reste exactement un spread sur l'ardoise. C'est voulu : cet argent-là n'a pas été récupéré." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0 && v.beTriggerR > 0, text:
    "Le BREAK-EVEN n'est pas touché par le dû : réglé en R, il s'arme au même seuil et pose le stop "
    + "au même niveau sur une position partie rembourser que sur n'importe quelle autre. Le dû "
    + "déplace la cible, pas la protection — c'est la même règle que sur le rFVG." },
  { kind: 'hint', when: v => v.display !== 'marker' && v.dueAfterSl > 0 && v.uniqueTrade !== true, text:
    "⚠ Sans « Trade unique », les positions se chevauchent : une sortie ne pèse sur le dû d'une "
    + "entrée que si elle a eu lieu AVANT elle. Le dû lu par une position peut donc être plus petit "
    + "que l'ardoise réelle au même instant — c'est le prix de ne pas remonter le temps." },

  { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP (0 = aucun)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'marker' },
  { kind: 'hint', when: v => v.display !== 'marker' && v.skipAfterTp > 0, text:
    "Après un TP touché, les N signaux suivants sont ignorés, puis on reprend — exactement N. Ils ne "
    + "sont listés nulle part, mais le moniteur et le rapport disent combien ont été sautés ET "
    + "combien auraient gagné : c'est ce second chiffre qui dit ce que le repos a coûté." },

  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: v => v.display !== 'marker' },
  { kind: 'hint', when: v => v.display !== 'marker' && v.uniqueTrade === true, text:
    "Une seule position à la fois : tout motif survenant avant la clôture de la position en cours "
    + "est ignoré, dans son sens comme à contre-sens, et n'apparaît nulle part. ⚠ Ce n'est pas un "
    + "filtre neutre — il écarte des signaux selon ce que le marché a fait ENTRE-TEMPS. Compare "
    + "toujours les deux modes avant d'y croire." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'color', key: 'bullColor', label: 'Couleur haussière', tint: '#26A69A' },
  { kind: 'color', key: 'bearColor', label: 'Couleur baissière', tint: '#EF5350' },
  { kind: 'segmented', key: 'markerSize', label: 'Taille marqueur', options: [
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « TB »' },
];
