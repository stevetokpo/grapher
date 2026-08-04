// super avalante — réglages : valeurs par défaut d'un côté, description du
// formulaire de l'autre. Même contrat que lib/ringble/params.js et
// lib/twins/params.js, et pour la même raison : ajouter un réglage se fait ICI,
// pas dans le panneau ni dans le graphe.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

// ── Détection ────────────────────────────────────────────────────────────────
export const DETECT_DEFAULTS = {
  // Le sens de la SUPER AVALANTE elle-même — la dernière bougie, celle qui avale.
  direction: 'both',

  // COMBIEN DE BOUGIES elle doit avaler, comptées DERRIÈRE la bougie opposée qui
  // la précède. 1 = la seule bougie qui précède l'opposée ; 2 = les deux, etc.
  // Pas de valeur neutre : sans bougie avalée il n'y a pas de motif, le minimum
  // est 1. C'est le réglage central du motif — c'est lui qui dit « super ».
  count: 2,

  // AVALEMENT STRICT — le haut de l'avalante doit dépasser le haut de chaque
  // bougie avalée, et son bas passer sous leur bas. Éteint (défaut), l'égalité
  // suffit : toucher exactement le même extrême, c'est encore l'avoir couvert.
  strict: false,

  // AVALER AUSSI LA BOUGIE OPPOSÉE qui précède immédiatement. Éteint par défaut :
  // la définition du motif dit expressément que celle-là peut dépasser. Allumé,
  // le motif devient une avalante classique doublée d'une super avalante.
  engulfPrev: false,
};

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor:  '#26A69A',   // avalante haussière — signal d'achat
  bearColor:  '#EF5350',   // avalante baissière — signal de vente
  showLabel:  true,
  markerSize: 1,
};

export const SUPER_AVAL_DEFAULTS = { ...DETECT_DEFAULTS, ...STYLE_DEFAULTS };

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
    "Une bougie qui en avale plusieurs d'un coup. Haussière : elle monte, la bougie juste avant "
    + "baisse, et les N bougies encore derrière tiennent ENTIÈREMENT — de leur plus bas à leur plus "
    + "haut — entre le plus bas et le plus haut de l'avalante. Baissière : la même chose à l'envers." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Haussière' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Baissière' },
  ] },

  { kind: 'number', key: 'count', label: 'Bougies avalées derrière l’opposée', min: 1, max: 50, step: 1 },
  { kind: 'hint', text:
    "Ces N bougies sont celles qui précèdent la bougie opposée, et elles sont CONTIGUËS : à 2, ce "
    + "sont les deux qui la précèdent immédiatement. Chacune doit être couverte en entier, mèches "
    + "comprises. Une seule qui dépasse et la figure tombe. Faute de N bougies d'histoire, la "
    + "figure est écartée — on ne devine pas ce qu'il y avait avant." },

  { kind: 'toggle', key: 'strict', label: 'Avalement strict',
    on: 'Dépasser', off: 'Égalité admise' },
  { kind: 'toggle', key: 'engulfPrev', label: 'Avaler aussi la bougie opposée',
    on: 'Exigé', off: 'Libre' },
  { kind: 'hint', text:
    "La bougie opposée qui précède immédiatement l'avalante n'a PAS à être couverte : elle peut "
    + "dépasser des deux côtés sans que la figure en souffre. L'exiger n'ajoute qu'une avalante "
    + "classique par-dessus la super avalante." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Haussière (achat)' },
    { kind: 'color', key: 'bearColor', label: 'Baissière (vente)' },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « SA »', on: 'Affichée', off: 'Masquée' },
  { kind: 'number', key: 'markerSize', label: 'Taille du repère', min: 0, max: 4, step: 1 },
];
