// ringble — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/liq/params.js et lib/rev/params.js, et pour la
// même raison : ajouter un réglage se fait ICI, pas dans le panneau ni dans le
// graphe.
//
// CE MOTIF SE RÈGLE PAR SENS. Chaque condition existe en DEUX exemplaires — un
// pour les BH (achat), un pour les HB (vente) — parce qu'un marché ne monte pas
// comme il descend, et qu'un seuil réglé sur les deux à la fois est un compromis
// qui ne convient à aucun des deux. Les clés portent le suffixe `Bull` / `Bear` :
// `ratioMinBull`, `ratioMinBear`, etc.
//
// AJOUTER UNE CONDITION, c'est toujours trois lignes, malgré le dédoublement :
//   1. le test              → ./detect.js, qui lit les réglages du SEUL sens jugé
//   2. sa valeur neutre     → SIDE_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ            → SIDE_FIELDS ici
// Les deux jeux de clés et les deux moitiés du formulaire se fabriquent ensuite
// tout seuls. Rien à recopier, donc rien à oublier d'un côté.

// ── Les deux sens ────────────────────────────────────────────────────────────
export const SIDES = [
  { side: 'bull', suffix: 'Bull', label: 'BH', title: 'BH — 2e bougie haussière (achat)' },
  { side: 'bear', suffix: 'Bear', label: 'HB', title: 'HB — 2e bougie baissière (vente)' },
];

// La clé effective d'une condition pour un sens donné.
export const sideKey = (cond, side) => cond + (side === 'bull' ? 'Bull' : 'Bear');

// ── Les conditions, définies UNE fois ────────────────────────────────────────
// Ce sont les valeurs par défaut de CHAQUE sens : les deux partent d'ici, puis
// se règlent séparément.
export const SIDE_DEFAULTS = {
  // COMMENT ON MESURE une bougie, pour la comparaison de taille uniquement.
  // 'range' — amplitude haut−bas, ce qu'on voit à l'écran (défaut)
  // 'body'  — corps |clôture−ouverture|
  sizeMode: 'range',

  // CONDITION 1 — la seconde bougie fait au moins la taille de la première, et
  // au plus ratioMax fois celle-ci. Bornes exprimées en multiples de la
  // PREMIÈRE bougie : 1 = même taille, 1.5 = une fois et demie.
  // Neutre : 0 de chaque côté (0 = borne éteinte).
  ratioMin: 1,
  ratioMax: 1.5,

  // CONDITION 2 — la seconde bougie est PLEINE : son corps occupe au moins cette
  // part de son amplitude totale. 0.8 = les mèches ne pèsent pas plus d'un
  // cinquième de la bougie. Mesure directe corps ÷ amplitude — même définition
  // que les bodyRatio du KO. Neutre : 0.
  bodyRatio2: 0.8,

  // CONDITION 3 — le motif marque un EXTRÊME. Le plus bas des deux bougies (BH)
  // ou le plus haut (HB) doit dépasser celui des `extremeBars` bougies qui
  // PRÉCÈDENT la paire. Filtre OPTIONNEL, éteint par défaut (0).
  extremeBars: 0,
};

// Le formulaire d'UN sens. Les libellés n'y nomment pas le sens : c'est le titre
// de section qui le dit, et ces champs servent aux deux.
const SIDE_FIELDS = [
  { kind: 'segmented', key: 'sizeMode', label: 'Mesure de la taille', options: [
    { value: 'range', label: 'Amplitude (H−B)' },
    { value: 'body',  label: 'Corps (|C−O|)' },
  ] },
  { kind: 'row', fields: [
    { kind: 'number', key: 'ratioMin', label: 'Au moins × la 1e (0 = off)', min: 0, max: 20, step: 0.1 },
    { kind: 'number', key: 'ratioMax', label: 'Au plus × la 1e (0 = off)',  min: 0, max: 20, step: 0.1 },
  ] },
  { kind: 'number', key: 'bodyRatio2',  label: 'Corps ÷ amplitude ≥ (0 = off)', min: 0, max: 1, step: 0.05 },
  { kind: 'number', key: 'extremeBars', label: 'Extrême sur N bougies (0 = off)', min: 0, max: 500, step: 1 },
];

// ── Détection ────────────────────────────────────────────────────────────────
export const DETECT_DEFAULTS = (() => {
  // `direction` reste commun : il ne règle rien, il dit seulement quels sens on
  // cherche. Éteindre un sens ici revient à ne jamais lire ses réglages.
  const out = { direction: 'both' };
  for (const { side } of SIDES) {
    for (const [cond, def] of Object.entries(SIDE_DEFAULTS)) out[sideKey(cond, side)] = def;
  }
  return out;
})();

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor:  '#26A69A',   // BH — la seconde bougie monte
  bearColor:  '#EF5350',   // HB — la seconde bougie baisse
  showLabel:  true,
  markerSize: 1,
};

export const RINGBLE_DEFAULTS = { ...DETECT_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

// Les réglages du SEUL sens demandé, à plat et sous leur nom générique
// (`ratioMin`, `bodyRatio2`, …). C'est ce que lit le détecteur : il juge une
// figure sans jamais savoir de quel suffixe elle vient.
export function sideOptions(p, side) {
  const out = {};
  for (const cond of Object.keys(SIDE_DEFAULTS)) {
    out[cond] = p[sideKey(cond, side)] ?? SIDE_DEFAULTS[cond];
  }
  return out;
}

export function styleOptions(pat = {}) {
  return {
    bullColor:  pat.bullColor  ?? STYLE_DEFAULTS.bullColor,
    bearColor:  pat.bearColor  ?? STYLE_DEFAULTS.bearColor,
    showLabel:  pat.showLabel !== false,
    markerSize: pat.markerSize ?? STYLE_DEFAULTS.markerSize,
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Les deux moitiés sont fabriquées depuis SIDE_FIELDS : un champ ajouté là-haut
// apparaît des deux côtés, sous sa clé suffixée, sans qu'on l'écrive deux fois.
const suffixed = (field, side) => {
  if (field.kind === 'row') return { ...field, fields: field.fields.map(f => suffixed(f, side)) };
  return field.key ? { ...field, key: sideKey(field.key, side) } : field;
};

export const FIELDS = [
  { kind: 'hint', text:
    "Deux bougies collées et de sens OPPOSÉS. HB — haussière puis baissière — signale une vente ; "
    + "BH — baissière puis haussière — un achat. C'est toujours la SECONDE bougie qui donne le sens, "
    + "et c'est elle que les conditions jugent." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ BH' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ HB' },
  ] },
  { kind: 'hint', text:
    "Chaque sens a SES réglages, réunis ci-dessous. Le marché ne monte pas comme il descend : un "
    + "seuil commun aux deux serait un compromis qui ne convient à aucun." },

  ...SIDES.flatMap(({ side, title }) => [
    { kind: 'divider', label: title },
    ...SIDE_FIELDS.map(f => suffixed(f, side)),
  ]),

  { kind: 'hint', text:
    "La taille de la 2e bougie se mesure en multiples de la PREMIÈRE : sous 1, elle est trop molle "
    + "pour retourner quoi que ce soit ; au-delà de 1.5, ce n'est plus une réponse à la première "
    + "bougie mais un mouvement à elle. Le corps ÷ amplitude dit à quel point elle est PLEINE — à "
    + "0.8, les deux mèches réunies ne pèsent pas plus d'un cinquième de la bougie." },
  { kind: 'hint', text:
    "« Extrême sur N bougies » exige que le motif marque un plus BAS (BH) ou un plus HAUT (HB) : "
    + "l'extrême des deux bougies doit dépasser celui des N bougies qui PRÉCÈDENT la paire — les "
    + "deux bougies du motif exclues, sinon on les comparerait à elles-mêmes. Strictement, et "
    + "toutes : une seule bougie qui égale l'extrême suffit à écarter la figure. Faute de N bougies "
    + "d'histoire, la figure est écartée — on ne devine pas ce qu'il y avait avant." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'BH (achat)' },
    { kind: 'color', key: 'bearColor', label: 'HB (vente)' },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « RB »', on: 'Affichée', off: 'Masquée' },
  { kind: 'number', key: 'markerSize', label: 'Taille du repère', min: 0, max: 4, step: 1 },
];
