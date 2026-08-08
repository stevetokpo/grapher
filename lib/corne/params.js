// corne — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/superAval/params.js et lib/ringble/params.js, et
// pour la même raison : ajouter un réglage se fait ICI, pas dans le panneau ni
// dans le graphe.
//
// PARTICULARITÉ DE CE MOTIF : il ne se lit pas dans les bougies, il se lit dans
// le RSI. Les seuils ci-dessous sont donc ceux du laboratoire — la page /rsi les
// règle sur des exemples marqués à la main, ce fichier ne fait que porter les
// valeurs retenues. Quand le labo tranche, c'est cette liste qui change.

// ── Détection ────────────────────────────────────────────────────────────────
export const DETECT_DEFAULTS = {
  // Le SENS du signal, pas celui du RSI : une corne (pointe en haut du RSI, puis
  // effondrement) est un signal BAISSIER ; la corne inversée est haussière.
  direction: 'both',

  // Le RSI qu'on regarde. 7 — c'est sur cette période que la figure a été vue.
  rsiPeriod: 7,

  // ZIGZAG — repli minimum, en points de RSI, pour qu'une pointe existe. C'est le
  // seul filtre de bruit en amont : trop bas, chaque dent de scie devient une
  // pointe ; trop haut, les cornes courtes disparaissent.
  minAmp: 8,

  // ── Ce qui fait la corne ───────────────────────────────────────────────────
  // « Elle met beaucoup de temps à monter » :
  minRiseBars: 8,      // bougies de la jambe lente
  minRiseAmp:  12,     // points de RSI gagnés sur cette jambe

  // « … puis descend brutalement » :
  maxDropBars: 2,      // bougies de la jambe rapide

  // « … en repassant sur plusieurs points passés » — les deux mesures qui
  // traduisent le mieux la description d'origine :
  minRewind:       8,  // bougies passées effacées par la chute
  minRewindPerBar: 4,  // … rapportées à chaque bougie de chute

  // La POINTE : pente de chute divisée par pente de montée. C'est le rapport qui
  // distingue une corne d'un simple sommet arrondi.
  minSharpness: 3,

  // Part de la montée rendue par la chute (1 = tout est rendu).
  minRetrace: 0.6,

  // Niveau du sommet (0 = on ne filtre pas). 70 exigerait une corne en surachat.
  minLevel: 0,
};

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor:  '#26A69A',   // corne inversée — signal d'achat
  bearColor:  '#EF5350',   // corne — signal de vente
  showLabel:  true,
  markerSize: 1,
};

export const CORNE_DEFAULTS = { ...DETECT_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

export function styleOptions(pat = {}) {
  return {
    bullColor:  pat.bullColor  ?? STYLE_DEFAULTS.bullColor,
    bearColor:  pat.bearColor  ?? STYLE_DEFAULTS.bearColor,
    showLabel:  pat.showLabel !== false,
    markerSize: pat.markerSize ?? STYLE_DEFAULTS.markerSize,
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
export const FIELDS = [
  { kind: 'hint', text:
    "Une figure du RSI, pas des bougies. Le RSI met longtemps à monter — une courbe lente — "
    + "fait une POINTE, puis s'effondre en une ou deux bougies jusqu'à repasser sous des valeurs "
    + "qu'il avait des dizaines de bougies plus tôt. La corne inversée est l'image miroir. "
    + "Le repère se pose sur la bougie où la chute est accomplie, jamais sur la pointe : "
    + "au sommet, personne ne peut encore savoir ce qui va suivre." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Inversée' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Corne' },
  ] },
  { kind: 'hint', text:
    "Le sens est celui du SIGNAL : la corne (pointe en haut du RSI puis effondrement) est "
    + "baissière, la corne inversée (creux pointu puis envolée) est haussière." },

  { kind: 'divider', label: 'Le RSI' },

  { kind: 'row', fields: [
    { kind: 'number', key: 'rsiPeriod', label: 'Période RSI', min: 2, max: 100, step: 1 },
    { kind: 'number', key: 'minAmp',    label: 'Zigzag (pts)', min: 1, max: 40, step: 1 },
  ] },
  { kind: 'hint', text:
    "Le zigzag découpe le RSI en jambes : une pointe n'existe que si le RSI s'en écarte ensuite "
    + "d'au moins ce nombre de points. C'est le filtre de bruit, et il change TOUT le reste — "
    + "les durées et les pentes se mesurent sur les jambes qu'il a découpées." },

  { kind: 'divider', label: 'La montée lente' },

  { kind: 'row', fields: [
    { kind: 'number', key: 'minRiseBars', label: 'Bougies ≥', min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'minRiseAmp',  label: 'Points RSI ≥', min: 0, max: 100, step: 1 },
  ] },

  { kind: 'divider', label: 'La chute brutale' },

  { kind: 'number', key: 'maxDropBars', label: 'Bougies ≤', min: 1, max: 20, step: 1 },
  { kind: 'hint', text:
    "C'est aussi le DÉLAI de détection : à 2, la figure est signalée au plus tard deux bougies "
    + "après la pointe, ou pas du tout." },

  { kind: 'row', fields: [
    { kind: 'number', key: 'minRewind',       label: 'Rembobinage ≥', min: 0, max: 500, step: 1 },
    { kind: 'number', key: 'minRewindPerBar', label: '… par bougie ≥', min: 0, max: 100, step: 0.5 },
  ] },
  { kind: 'hint', text:
    "Le rembobinage compte les bougies passées que la chute efface : le RSI retombe au niveau "
    + "qu'il avait N bougies plus tôt. Rapporté à chaque bougie de chute, c'est la mesure la plus "
    + "proche de ce qu'on voit — une bougie qui annule vingt bougies de travail." },

  { kind: 'divider', label: 'La pointe' },

  { kind: 'row', fields: [
    { kind: 'number', key: 'minSharpness', label: 'Pointe ≥ ×', min: 0, max: 50, step: 0.5 },
    { kind: 'number', key: 'minRetrace',   label: 'Retour ≥',   min: 0, max: 3,  step: 0.1 },
  ] },
  { kind: 'hint', text:
    "« Pointe » = pente de la chute divisée par pente de la montée : à ×3, le RSI redescend trois "
    + "fois plus vite qu'il n'est monté. « Retour » = part de la montée rendue par la chute ; "
    + "à 1, tout est rendu, au-delà la chute va plus bas que le creux de départ." },

  { kind: 'number', key: 'minLevel', label: 'Niveau du sommet ≥', min: 0, max: 100, step: 5 },
  { kind: 'hint', text:
    "0 = aucun filtre de niveau. À 70, seules les cornes formées en surachat comptent "
    + "(et en survente pour les inversées : le niveau est lu en miroir)." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Inversée (achat)' },
    { kind: 'color', key: 'bearColor', label: 'Corne (vente)' },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « CO »', on: 'Affichée', off: 'Masquée' },
  { kind: 'number', key: 'markerSize', label: 'Taille du repère', min: 0, max: 4, step: 1 },
];
