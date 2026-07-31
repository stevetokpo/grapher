// liq — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/xfvg/params.js, et pour la même raison : ajouter
// un réglage se fait ICI, pas dans le panneau ni dans le graphe.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

// ── Détection ────────────────────────────────────────────────────────────────
// Les NOMS atrMult / sizeMode / atrMult3 / wick3 ne sont pas libres : ce sont
// ceux que lisent les prédicats partagés de lib/candleRules.js. Le panneau les
// présente sous les libellés de ce motif-ci (« impulsion », « respiration »),
// mais les rebaptiser ici casserait la détection.
export const DETECT_DEFAULTS = {
  direction: 'both',  // sens de la SECONDE impulsion, celle qui retourne le marché
  atrPeriod: 14,
  // L'impulsion — les deux bouts de la pince.
  atrMult:   1.5,     // taille >= x × ATR (0 = off : n'importe quelle bougie directionnelle)
  sizeMode:  'range', // ... mesurée en amplitude ou en corps
  // La respiration — ce qu'il y a entre les deux, et qui doit ne rien faire.
  atrMult3:  0.3,     // corps <= x × ATR (0 = off)
  wick3:     false,   // mèche de rejet > corps (false = off)
  // La fenêtre. C'est un écart entre les deux IMPULSIONS : le nombre de
  // respirations va donc de 1 à maxBars−1. En dessous de 2, aucune pince ne peut
  // exister (il faut au moins une bougie au milieu).
  maxBars:   10,
  // Filtre des bandes de Bollinger. La pince doit s'être formée à l'EXTÉRIEUR de
  // la bande, du côté que son retournement suppose : haussière entièrement sous
  // la bande BASSE, baissière entièrement au-dessus de la bande HAUTE. Seules les
  // deux impulsions sont jugées, mèches comprises.
  bbFilter:  true,
  bbPeriod:  200,
  bbDev:     1,
  // HAUTEUR DE LA ZONE, en POINTS de prix — la hauteur EXACTE et totale, pas un
  // minimum : la bande fait ça de haut, centrée sur le niveau (moitié au-dessus,
  // moitié en dessous). C'est ce qui en fait autre chose qu'un trait : une bande
  // mesurable, dans laquelle le prix peut REVENIR. L'entrée s'en sert, le dessin
  // aussi, et il n'y a qu'une définition pour les deux.
  // Valeur à régler par instrument : 2 points ne veulent pas dire la même chose
  // sur XAUUSD et sur BTCUSD.
  zonePts:   2,
  // Prolongement du trait à DROITE, en barres au-delà de la seconde impulsion.
  // Sans lui le trait ne couvre que la figure elle-même — trois ou quatre
  // bougies, illisible. Un niveau se regarde dans ce qui vient APRÈS. 0 = pas de
  // prolongement ; au-delà des données disponibles, il s'arrête au bord.
  extBars:   50,
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit ./positions.js. Séparé de la détection : ces réglages ne peuvent ni
// créer ni supprimer un motif, seulement décider ce qu'on en fait.
export const POSITION_DEFAULTS = {
  // 'level' = le trait seul | 'position' = les trades | 'both'.
  // Défaut sur 'both' : tant que le motif n'avait pas de positions, 'level' allait
  // de soi ; maintenant qu'il en a, ce défaut cachait le moniteur ET le bouton de
  // rapport, sans rien dire. Un réglage qui rend une fonctionnalité invisible ne
  // doit pas être celui par défaut.
  display:     'both',
  // COMMENT ON ENTRE :
  //   'zone'   — on attend que le prix REVIENNE dans la bande tracée, et on est
  //              rempli à son bord. C'est un ordre en attente : il peut ne jamais
  //              être servi, et le signal est alors 'missed'.
  //   'market' — au marché à l'ouverture de la bougie qui suit la 2e impulsion.
  //              Le comportement d'avant, gardé pour pouvoir comparer.
  entryMode:   'zone',
  // Combien de bougies on laisse à l'ordre pour être servi, à partir de celle qui
  // suit la 2e impulsion. 0 = sans limite (jusqu'au bord des données).
  entryWaitBars: 20,
  rr:          2,        // TP = entrée ± rr × risque
  // D'où vient le stop, et donc le R :
  //   'structure' — sous/sur l'extrême de TOUTES les bougies du motif. Le risque
  //                 varie d'une position à l'autre, au gré de la taille du motif.
  //   'points'    — une distance FIXE depuis l'entrée. Le risque devient constant,
  //                 et compter en points ou en R revient alors au même.
  slMode:      'structure',
  slMarginPts: 0,        // mode 'structure' : marge sous/sur l'extrême. 0 = pile dessus
  slPts:       10,       // mode 'points' : la distance, qui EST le R
  spreadPts:   0,        // coût de l'aller-retour, déduit de chaque position clôturée
  // Break-even, tout en R — le risque variant d'une position à l'autre, un seuil
  // en points ne voudrait pas dire la même chose deux fois. Le TP étant déjà un
  // RR, les trois réglages se lisent alors sur la même échelle.
  beTriggerR:  0,        // SEUIL : le stop bouge quand le gain atteint x × risque. 0 = pas de BE
  beLevelR:    0,        // BLOCAGE : où va le stop, en R depuis l'entrée. 0 = à l'entrée
  // Une seule position à la fois. ÉTEINT par défaut : le comportement de base est
  // de tout prendre, y compris les motifs qui se chevauchent.
  uniqueTrade: false,
  // Repos après un gain : combien de signaux sauter une fois un TP touché.
  // 0 = aucun repos.
  skipAfterTp: 0,
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Le motif se marque d'un TRAIT, pas d'une boîte : c'est un prix atteint, pas
// une zone balayée. Une couleur par sens — c'est la seule chose qui distingue
// une pince haussière d'une baissière à l'œil.
export const STYLE_DEFAULTS = {
  // Bleu marine et rouge. Le marine est éclairci par rapport au vrai #000080,
  // qui disparaît purement et simplement sur un fond de graphe sombre : il reste
  // lu comme un bleu profond, mais il se voit.
  bullColor: '#2B4FD8',  // liq haussier — le plus HAUT des respirations
  bearColor: '#E53935',  // liq baissier — le plus BAS des respirations
  opacity:   1,          // un niveau se lit ou ne se lit pas — pas de demi-teinte
  showLabel: true,
};

export const LIQ_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

// Détection + position : le simulateur a besoin des deux, puisqu'il redétecte les
// motifs avant de les jouer.
export const positionOptions = (pat = {}) => ({
  ...pick(pat, DETECT_DEFAULTS),
  ...pick(pat, POSITION_DEFAULTS),
});

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    opacity:   pat.opacity   ?? STYLE_DEFAULTS.opacity,
    showLabel: pat.showLabel !== false,
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Rendu par <SchemaForm> (components/PatternPanel.js).
// Types : 'segmented' | 'number' | 'toggle' | 'color' | 'row' | 'divider' | 'hint'.
// `when: v => …` masque un champ selon les réglages courants.
export const FIELDS = [
  { kind: 'hint', text:
    "Une impulsion, une respiration, puis une impulsion de sens INVERSE. Aucun déséquilibre "
    + "n'est exigé — c'est ce qui distingue ce motif du xFVG : il n'y a pas de gap à trouver, "
    + "seulement un aller-retour serré. Le trait marque l'extrême atteint pendant la respiration : "
    + "le plus HAUT des bougies du milieu si la pince est haussière, le plus BAS si elle est "
    + "baissière. Les deux grandes bougies n'entrent pas dans ce calcul." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Haussier' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Baissier' },
  ] },
  { kind: 'hint', text:
    "Le sens est celui de la SECONDE impulsion, celle qui retourne le marché : « haussier » garde "
    + "les pinces qui finissent en poussée haussière." },

  { kind: 'divider', label: 'Les impulsions — les deux bouts' },

  { kind: 'segmented', key: 'sizeMode', label: 'Mesure de la taille', options: [
    { value: 'range', label: 'Amplitude (H−B)' },
    { value: 'body',  label: 'Corps (|C−O|)' },
  ] },
  { kind: 'row', fields: [
    { kind: 'number', key: 'atrPeriod', label: 'Période ATR',              min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'atrMult',   label: 'Taille ≥ ATR × (0 = off)', min: 0, max: 20,  step: 0.1 },
  ] },
  { kind: 'hint', text:
    "Les deux impulsions doivent satisfaire cette même condition. L'ATR est lu sur la bougie qui "
    + "précède, sinon il contiendrait déjà celle qu'on juge." },

  { kind: 'divider', label: 'La respiration — ce qu’il y a entre' },

  { kind: 'number', key: 'atrMult3', label: 'Corps ≤ ATR × (0 = off)', min: 0, max: 20, step: 0.1 },
  { kind: 'toggle', key: 'wick3',    label: 'Mèche de rejet' },
  { kind: 'hint', text:
    "TOUTES les bougies entre les deux impulsions doivent respecter ces conditions : une seule qui "
    + "reprend la main rompt la chaîne et la pince est rejetée. La mèche se juge du côté d'où vient "
    + "le mouvement — BASSE après une impulsion haussière, HAUTE après une baissière." },
  { kind: 'hint', when: v => !(v.atrMult3 > 0) && v.wick3 !== true, text:
    "⚠ Les deux conditions sont ÉTEINTES : n'importe quelle bougie fait alors une respiration "
    + "valable, et le motif se réduit à « deux impulsions opposées à moins de N barres ». Beaucoup "
    + "de signaux, peu de sens — remonte « Corps ≤ ATR × » pour qu'il morde." },

  { kind: 'divider', label: 'La zone' },

  { kind: 'number', key: 'zonePts', label: 'Hauteur de la zone (points)', min: 0, max: 100000, step: 0.1 },
  { kind: 'hint', text:
    "Hauteur EXACTE et totale de la bande, en points de prix : elle est centrée sur le niveau, "
    + "moitié au-dessus, moitié en dessous. C'est elle que le prix doit atteindre pour qu'une "
    + "position soit prise, et c'est elle qui sert à sizer. À régler par instrument — 2 points ne "
    + "veulent pas dire la même chose sur XAUUSD et sur BTCUSD." },

  { kind: 'divider', label: 'Filtre des bandes de Bollinger' },

  { kind: 'toggle', key: 'bbFilter', label: 'Exiger la pince hors de la bande' },
  { kind: 'hint', text:
    "Ne garde que les pinces formées à l'EXTÉRIEUR de la bande, du côté que leur retournement "
    + "suppose : haussière entièrement SOUS la bande basse, baissière entièrement AU-DESSUS de la "
    + "bande haute. Seules les deux impulsions sont jugées — les respirations ont le droit de "
    + "rentrer dans la bande." },
  { kind: 'row', when: v => v.bbFilter === true, fields: [
    { kind: 'number', key: 'bbPeriod', label: 'Période',    min: 2, max: 1000, step: 1 },
    { kind: 'number', key: 'bbDev',    label: 'Écart-type', min: 0.1, max: 10, step: 0.1 },
  ] },
  { kind: 'hint', when: v => v.bbFilter === true, text:
    "« Complètement » au pied de la lettre : mèches comprises, rien de l'impulsion ne dépasse la "
    + "bande. Même calcul que l'indicateur Bollinger du graphe (clôtures, écart-type de "
    + "population), pour que le filtre juge sur la bande que tu vois. Tant que la période n'est "
    + "pas remplie, aucune pince n'est retenue : on ne devine pas où était la bande." },

  { kind: 'divider', label: 'La fenêtre' },

  { kind: 'number', key: 'maxBars', label: 'Écart max entre impulsions (barres)', min: 2, max: 500, step: 1 },
  { kind: 'hint', text:
    "Compté d'une impulsion à l'autre : le nombre de respirations va de 1 à cette valeur moins 1. "
    + "Deux impulsions collées, sans rien entre elles, ne forment pas une pince." },

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'level',    label: 'Niveau' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => v.display === 'level', text:
    "⚠ En « Niveau », aucune position n'est simulée : ni le moniteur en haut à gauche du graphe, "
    + "ni le bouton de téléchargement du rapport n'apparaissent. Passe sur « Position » ou "
    + "« Les deux » pour les retrouver." },
  { kind: 'segmented', key: 'entryMode', label: 'Entrée', when: v => v.display !== 'level', options: [
    { value: 'zone',   label: 'Retour dans la zone' },
    { value: 'market', label: 'Au marché' },
  ] },
  { kind: 'number', key: 'entryWaitBars', label: 'Attente max (barres, 0 = sans limite)',
    min: 0, max: 500, step: 1, when: v => v.display !== 'level' && (v.entryMode ?? 'zone') === 'zone' },
  { kind: 'hint', when: v => v.display !== 'level' && (v.entryMode ?? 'zone') === 'zone', text:
    "Ordre EN ATTENTE au bord de la bande : on n'entre que si le prix y revient. Le remplissage se "
    + "fait au bord que le prix atteint en premier — pas au milieu, pas au niveau exact — et à "
    + "l'ouverture si la bougie a ouvert au-delà. Passé le délai d'attente, l'ordre est annulé et "
    + "le signal est compté « Raté » : il reste visible dans le rapport, hors statistiques. C'est "
    + "voulu — les cacher donnerait un taux de réussite calculé sur les seuls trades que le marché "
    + "a bien voulu servir. La hauteur de la bande se règle plus haut, « Hauteur de la zone »." },
  { kind: 'hint', when: v => v.display !== 'level' && v.entryMode === 'market', text:
    "Au marché à l'ouverture de la bougie qui suit la seconde impulsion : une position est "
    + "toujours prise, aucun signal n'est raté. C'est le comportement d'origine, gardé pour "
    + "pouvoir mesurer ce que l'attente en zone apporte ou coûte." },
  { kind: 'hint', when: v => v.display !== 'level', text:
    "Achat sur pince haussière, vente sur baissière. Le stop va sous le plus BAS de TOUTES les "
    + "bougies du motif (au-dessus du plus HAUT en vente), première et seconde impulsions "
    + "comprises. Il est connu avant l'entrée, donc actif dès la première bougie, contrairement au "
    + "rFVG." },
  { kind: 'segmented', key: 'slMode', label: 'Origine du stop', when: v => v.display !== 'level', options: [
    { value: 'structure', label: 'Extrêmes du motif' },
    { value: 'points',    label: 'Distance fixe' },
  ] },
  { kind: 'row', when: v => v.display !== 'level', fields: [
    { kind: 'number', key: 'rr', label: 'RR du TP', min: 0.1, max: 50, step: 0.1 },
    { kind: 'number', key: 'slMarginPts', label: 'Marge du SL (points)', min: 0, max: 10000, step: 0.1 },
  ] },
  { kind: 'number', key: 'slPts', label: 'Distance du SL (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'level' && v.slMode === 'points' },
  { kind: 'hint', when: v => v.display !== 'level' && v.slMode === 'structure', text:
    "Le stop va sous le plus BAS de TOUTES les bougies du motif (au-dessus du plus HAUT en vente), "
    + "moins la marge. Le risque suit donc la taille du motif et varie d'une position à l'autre — "
    + "c'est ce qui oblige à lire les gains en POINTS plutôt qu'en R, et à comparer le winrate au "
    + "seuil de rentabilité RÉALISÉ." },
  { kind: 'hint', when: v => v.display !== 'level' && v.slMode === 'points', text:
    "Le stop est à distance fixe de l'entrée : le risque devient CONSTANT. Points et R ne disent "
    + "plus alors que la même chose, et le seuil de rentabilité redevient le 1/(1+RR) des manuels "
    + "(33 % à RR 2). La marge ci-dessus ne sert plus — elle ne concerne que les extrêmes du motif." },
  { kind: 'number', key: 'spreadPts', label: 'Spread (points)', min: 0, max: 10000, step: 0.1,
    when: v => v.display !== 'level' },
  { kind: 'hint', when: v => v.display !== 'level', text:
    "TP = entrée ± RR × |entrée − stop|. Le risque varie d'une position à l'autre, le RR non. "
    + "Marge à 0 = le stop est pile sur l'extrême du motif. Le spread est le coût de l'aller-retour, "
    + "déduit de chaque position clôturée : profitPoints reste le brut, netPoints le réel." },

  { kind: 'row', when: v => v.display !== 'level', fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'hint', when: v => v.display !== 'level' && v.beTriggerR > 0, text:
    "Dès qu'une bougie avance de SEUIL × risque dans le sens de la position, le stop se déplace à "
    + "entrée ± BLOCAGE × risque, et n'y bouge plus jamais : c'est un déplacement unique, pas un "
    + "stop suiveur. Blocage à 0 = stop à l'entrée (le vrai break-even) ; 0,5 = un demi-R sécurisé ; "
    + "négatif = on réduit la perte sans l'annuler. Le stop déplacé ne peut jamais ÉLARGIR le "
    + "risque — un blocage sous le stop d'origine est ignoré. Anti-anticipation : le stop ne prend "
    + "effet qu'à la CLÔTURE de la bougie qui l'a armé, il ne peut donc pas être touché sur cette "
    + "bougie-là. Sortie sur ce stop = statut « be »." },
  { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP (0 = aucun)',
    min: 0, max: 100, step: 1, when: v => v.display !== 'level' },
  { kind: 'hint', when: v => v.display !== 'level' && v.skipAfterTp > 0, text:
    "Après un TP touché, les N signaux suivants sont ignorés, puis on reprend — exactement N, un "
    + "signal sauté qui aurait gagné ne relance pas le compteur. Ils ne sont listés nulle part, "
    + "mais le moniteur et le rapport disent combien ont été sautés ET combien auraient gagné : "
    + "c'est ce second chiffre qui dit ce que le repos a coûté. Un signal n'est écarté que s'il "
    + "entre APRÈS la sortie du gain qui a armé le repos — il ne pouvait pas savoir avant." },

  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: v => v.display !== 'level' },
  { kind: 'hint', when: v => v.display !== 'level' && v.uniqueTrade === true, text:
    "Une seule position à la fois : tout motif survenant avant la clôture de la position en cours "
    + "est ignoré, dans son sens comme à contre-sens, et n'apparaît nulle part. ⚠ Ce n'est pas un "
    + "filtre neutre — il écarte des signaux selon ce que le marché a fait ENTRE-TEMPS. Une "
    + "position qui traîne masque les suivants, et si ceux-là étaient les mauvais, la stratégie "
    + "paraît meilleure sans avoir changé. Compare toujours les deux modes avant d'y croire." },
  { kind: 'hint', when: v => v.display !== 'level' && v.beTriggerR > 0 && v.beTriggerR >= (v.rr ?? 2), text:
    "⚠ Le seuil est au-dessus du RR du TP : le TP sera toujours touché avant, et le BE ne s'armera "
    + "jamais. Descends le seuil sous le RR pour qu'il serve." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'color', key: 'bullColor', label: 'Pince haussière — plus haut', tint: '#2B4FD8' },
  { kind: 'color', key: 'bearColor', label: 'Pince baissière — plus bas',  tint: '#E53935' },
  { kind: 'row', fields: [
    { kind: 'number', key: 'extBars', label: 'Longueur à droite (barres)', min: 0, max: 500, step: 5 },
    { kind: 'number', key: 'opacity', label: 'Opacité',                    min: 0.05, max: 1, step: 0.05 },
  ] },
  { kind: 'hint', text:
    "La HAUTEUR de la bande se règle plus haut, « Hauteur de la zone », en points de prix — c'est "
    + "le seul réglage de hauteur. La bande couvre la figure puis se prolonge vers la droite : "
    + "0 = pas de prolongement, elle ne dure alors que le temps de la pince." },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « liq »' },
];
