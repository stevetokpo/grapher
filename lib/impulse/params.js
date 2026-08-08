// impulse — réglages : valeurs par défaut d'un côté, description du formulaire
// de l'autre. Même contrat que lib/xfvg/params.js et lib/superAval/params.js, et
// pour la même raison : ajouter un réglage se fait ICI, pas dans le panneau ni
// dans le graphe.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

// ── Détection ────────────────────────────────────────────────────────────────
export const DETECT_DEFAULTS = {
  // Le sens de la VAGUE : une suite de bougies toutes haussières, ou toutes
  // baissières.
  direction: 'both',

  // COMBIEN de bougies de suite font une vague. C'est le réglage central du
  // motif — c'est lui qui dit « impulsion ». Pas de valeur neutre : en dessous
  // de 2 bougies il n'y a pas de suite, le minimum est 2.
  count: 4,

  // PLAFOND de bougies : au-delà, ce n'est plus une impulsion mais une tendance
  // qu'on ne veut pas encadrer. 0 = pas de plafond.
  maxCount: 0,

  // PROLONGEMENT EN ARRIÈRE, en périodes, depuis la PREMIÈRE bougie de la vague.
  // C'est la longueur de la boîte à gauche : la zone couvre ce que l'impulsion a
  // traversé, et remonte y bougies avant son départ. 0 = la boîte commence à la
  // première bougie de la vague.
  back: 10,

  // PROLONGEMENT À DROITE, en périodes, depuis la DERNIÈRE bougie de la vague.
  // 0 (défaut) : la boîte s'arrête à la dernière bougie, comme le motif le dit.
  fwd: 0,

  // LA HAUTEUR de la boîte :
  //   'ends'   — la 1re et la dernière bougie de la vague, mèches comprises.
  //              C'est la définition du motif ; les mèches des bougies du milieu
  //              peuvent donc dépasser de la boîte.
  //   'wave'   — les extrêmes de TOUTE la vague : rien ne dépasse plus.
  //   'bodies' — l'ouverture de la 1re et la clôture de la dernière : le corps
  //              du mouvement, sans les mèches des deux bouts.
  heightMode: 'ends',

  // AMPLITUDE MINIMALE de la boîte, en points de prix. Une suite de 5 bougies
  // minuscules est une suite, pas une impulsion. 0 = éteint.
  minPts: 0,

  // AMPLITUDE MINIMALE relative : hauteur de la boîte ≥ atrMult × ATR. L'ATR est
  // lu sur la bougie qui PRÉCÈDE la vague — le lire dedans reviendrait à mesurer
  // l'impulsion avec elle-même. 0 = éteint.
  atrPeriod: 14,
  atrMult:   0,

  // CORPS PLEIN : chaque bougie de la vague doit avoir un corps ≥ bodyRatio ×
  // son amplitude. Une suite de bougies à longues mèches n'est pas une poussée.
  // 0 = éteint.
  bodyRatio: 0,

  // UN DOJI ROMPT-IL LA VAGUE ? Allumé (défaut), oui : la suite s'arrête là.
  // Éteint, la vague l'enjambe — il ne compte pas comme bougie de la vague, mais
  // il ne la casse pas non plus.
  dojiBreaks: true,
};

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',   // vague haussière
  bearColor: '#EF5350',   // vague baissière
  opacity:   0.18,
  showLabel: true,
};

export const IMPULSE_DEFAULTS = { ...DETECT_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    opacity:   pat.opacity   ?? STYLE_DEFAULTS.opacity,
    showLabel: pat.showLabel !== false,
    labelText: 'impulse',
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
export const FIELDS = [
  { kind: 'hint', text:
    "Une suite de bougies du même sens — au moins N à la file — encadrée d'une boîte. La boîte va "
    + "de la 1re à la dernière bougie de la vague en hauteur, s'arrête à la dernière en largeur, et "
    + "se prolonge de Y périodes EN ARRIÈRE de la première." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Haussière' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Baissière' },
  ] },

  { kind: 'number', key: 'count',    label: 'Bougies à la file (min)', min: 2, max: 50, step: 1 },
  { kind: 'number', key: 'maxCount', label: 'Bougies à la file (max, 0 = libre)', min: 0, max: 100, step: 1 },
  { kind: 'hint', text:
    "La vague retenue est toujours la PLUS LONGUE : une suite de 7 bougies donne une seule boîte de "
    + "7, pas quatre boîtes de 4. Une seule bougie de sens contraire y met fin." },

  { kind: 'toggle', key: 'dojiBreaks', label: 'Un doji rompt la vague',
    on: 'Rompt', off: 'Enjambé' },

  { kind: 'divider', label: 'La boîte' },

  { kind: 'number', key: 'back', label: 'Prolongement en arrière (périodes)', min: 0, max: 500, step: 1 },
  { kind: 'number', key: 'fwd',  label: 'Prolongement en avant (périodes)',   min: 0, max: 500, step: 1 },

  { kind: 'select', key: 'heightMode', label: 'Hauteur', options: [
    { value: 'ends',   label: '1re & dernière bougie (mèches)' },
    { value: 'wave',   label: 'Toute la vague (mèches)' },
    { value: 'bodies', label: 'Ouverture 1re → clôture dernière' },
  ] },
  { kind: 'hint', text:
    "En « 1re & dernière », les mèches des bougies du MILIEU peuvent sortir de la boîte : c'est "
    + "voulu, la hauteur est celle des deux bouts. « Toute la vague » ferme la boîte sur tout." },

  { kind: 'divider', label: 'Force de l’impulsion' },

  { kind: 'number', key: 'minPts', label: 'Hauteur min (points, 0 = libre)', min: 0, max: 100000, step: 1 },
  { kind: 'number', key: 'atrMult', label: 'Hauteur min (× ATR, 0 = libre)', min: 0, max: 20, step: 0.1 },
  { kind: 'number', key: 'atrPeriod', label: 'Période ATR', min: 2, max: 200, step: 1,
    when: v => v.atrMult > 0 },
  { kind: 'hint', text:
    "Les deux mesures portent sur la HAUTEUR DE LA BOÎTE, celle qu'on voit. L'ATR est lu sur la "
    + "bougie qui précède la vague : le lire dedans reviendrait à mesurer l'impulsion avec elle-même." },

  { kind: 'number', key: 'bodyRatio', label: 'Corps min de chaque bougie (0–1)', min: 0, max: 1, step: 0.05 },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'row', fields: [
    { kind: 'color', key: 'bullColor', label: 'Haussière' },
    { kind: 'color', key: 'bearColor', label: 'Baissière' },
  ] },
  { kind: 'number', key: 'opacity', label: 'Opacité', min: 0, max: 1, step: 0.02 },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette', on: 'Affichée', off: 'Masquée' },
];
