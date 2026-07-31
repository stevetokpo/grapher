// rev — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Même contrat que lib/liq/params.js.
//
// AJOUTER UNE CONDITION, c'est trois lignes :
//   1. le test           → ./detect.js
//   2. sa valeur neutre  → DETECT_DEFAULTS ici (neutre = condition éteinte)
//   3. son champ         → FIELDS ici

// ── Détection ────────────────────────────────────────────────────────────────
// Les NOMS atrMult / sizeMode / atrMult3 ne sont pas libres : ce sont ceux que
// lisent les prédicats partagés de lib/candleRules.js. Le panneau les présente
// sous les libellés de ce motif-ci (« impulsions », « pause »), mais les
// rebaptiser ici casserait la détection.
export const DETECT_DEFAULTS = {
  direction: 'both',  // sens de la SECONDE impulsion : celle qui retourne le marché
  atrPeriod: 14,
  // La PAUSE — la bougie qui ne va nulle part, avant le retournement.
  atrMult3:  0.3,     // corps <= x × ATR (0 = off)
  // Les IMPULSIONS — les deux bougies opposées qui suivent.
  atrMult:   1.5,     // corps >= x × ATR (0 = off)
  sizeMode:  'body',  // le motif est défini au CORPS ; 'range' reste possible
  // Hauteur EXACTE et totale de la bande, en POINTS de prix, centrée sur le
  // niveau. À régler par instrument.
  zonePts:   2,
  // Prolongement de la bande à droite, en barres au-delà du motif.
  extBars:   50,
};

// ── Prise de position ────────────────────────────────────────────────────────
// Ce que lit lib/patternPositions.js, via ./positions.js.
export const POSITION_DEFAULTS = {
  display:     'both',   // 'level' | 'position' | 'both'
  // L'entrée. Ce motif s'exécute AU MARCHÉ par défaut — c'est ce qui le distingue
  // du liq. Le retour en zone reste disponible : le niveau est alors le plus BAS
  // de la pause pour un achat, le plus HAUT pour une vente.
  entryMode:   'market',
  entryWaitBars: 20,
  rr:          2,
  slMode:      'structure',
  slMarginPts: 0,
  slPts:       10,
  spreadPts:   0,
  beTriggerR:  0,
  beLevelR:    0,
  uniqueTrade: false,
  skipAfterTp: 0,
};

// ── Habillage ────────────────────────────────────────────────────────────────
export const STYLE_DEFAULTS = {
  bullColor: '#34D399',  // achat — niveau au plus BAS de la pause
  bearColor: '#FB923C',  // vente — niveau au plus HAUT de la pause
  opacity:   1,
  showLabel: true,
};

export const REV_DEFAULTS = { ...DETECT_DEFAULTS, ...POSITION_DEFAULTS, ...STYLE_DEFAULTS };

const pick = (pat, defaults) => {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = pat[k] ?? defaults[k];
  return out;
};

export const detectOptions = (pat = {}) => pick(pat, DETECT_DEFAULTS);

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
export const FIELDS = [
  { kind: 'hint', text:
    "Trois bougies qui se suivent : une PAUSE, puis DEUX impulsions de sens opposés. Le sens du "
    + "signal est celui de la SECONDE impulsion — haussière puis baissière = vente, baissière puis "
    + "haussière = achat." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Achat' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Vente' },
  ] },

  { kind: 'divider', label: 'La pause' },

  { kind: 'row', fields: [
    { kind: 'number', key: 'atrPeriod', label: 'Période ATR',            min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'atrMult3',  label: 'Corps ≤ ATR × (0 = off)', min: 0, max: 20,  step: 0.1 },
  ] },
  { kind: 'hint', text:
    "La bougie qui précède le retournement doit ne rien faire : son corps reste sous ce multiple "
    + "de l'ATR. L'ATR est lu sur la bougie d'avant, sinon il contiendrait déjà celle qu'on juge." },

  { kind: 'divider', label: 'Les deux impulsions' },

  { kind: 'segmented', key: 'sizeMode', label: 'Mesure de la taille', options: [
    { value: 'body',  label: 'Corps (|C−O|)' },
    { value: 'range', label: 'Amplitude (H−B)' },
  ] },
  { kind: 'number', key: 'atrMult', label: 'Taille ≥ ATR × (0 = off)', min: 0, max: 20, step: 0.1 },
  { kind: 'hint', text:
    "Les deux bougies qui suivent la pause doivent chacune satisfaire cette condition, et être de "
    + "sens OPPOSÉS l'une de l'autre. Le motif a été défini au CORPS — l'amplitude reste possible, "
    + "mais ce n'est plus tout à fait le même motif." },

  { kind: 'divider', label: 'La zone' },

  { kind: 'number', key: 'zonePts', label: 'Hauteur de la zone (points)', min: 0, max: 100000, step: 0.1 },
  { kind: 'hint', text:
    "Le niveau est pris sur la PAUSE, du côté d'où le mouvement est venu : le plus BAS de la pause "
    + "pour un achat, le plus HAUT pour une vente. La bande fait cette hauteur exacte, centrée sur "
    + "lui. C'est elle que le prix doit revenir toucher si l'entrée est réglée sur « retour dans la "
    + "zone », et c'est elle qui sert à sizer." },

  { kind: 'divider', label: 'Prise de position' },

  { kind: 'segmented', key: 'display', label: 'Représentation', options: [
    { value: 'level',    label: 'Niveau' },
    { value: 'position', label: 'Position' },
    { value: 'both',     label: 'Les deux' },
  ] },
  { kind: 'hint', when: v => v.display === 'level', text:
    "⚠ En « Niveau », aucune position n'est simulée : ni moniteur, ni bouton de rapport." },

  { kind: 'segmented', key: 'entryMode', label: 'Entrée', when: v => v.display !== 'level', options: [
    { value: 'market', label: 'Au marché' },
    { value: 'zone',   label: 'Retour dans la zone' },
  ] },
  { kind: 'hint', when: v => v.display !== 'level' && (v.entryMode ?? 'market') === 'market', text:
    "Au marché à l'ouverture de la bougie qui suit la seconde impulsion : une position est toujours "
    + "prise, aucun signal n'est raté." },
  { kind: 'number', key: 'entryWaitBars', label: 'Attente max (barres, 0 = sans limite)',
    min: 0, max: 500, step: 1, when: v => v.display !== 'level' && v.entryMode === 'zone' },
  { kind: 'hint', when: v => v.display !== 'level' && v.entryMode === 'zone', text:
    "Ordre EN ATTENTE au bord de la bande : on n'entre que si le prix y REVIENT — il doit donc en "
    + "être sorti d'abord. Passé le délai, l'ordre est annulé et le signal est compté « Raté » : il "
    + "reste dans le rapport, hors statistiques." },

  { kind: 'segmented', key: 'slMode', label: 'Origine du stop', when: v => v.display !== 'level', options: [
    { value: 'structure', label: 'Extrêmes du motif' },
    { value: 'points',    label: 'Distance fixe' },
  ] },
  { kind: 'row', when: v => v.display !== 'level', fields: [
    { kind: 'number', key: 'rr',          label: 'RR du TP',              min: 0.1, max: 50,    step: 0.1 },
    { kind: 'number', key: 'slMarginPts', label: 'Marge du SL (points)',  min: 0,   max: 10000, step: 0.1 },
  ] },
  { kind: 'number', key: 'slPts', label: 'Distance du SL (points)', min: 0.1, max: 100000, step: 0.1,
    when: v => v.display !== 'level' && v.slMode === 'points' },
  { kind: 'hint', when: v => v.display !== 'level' && v.slMode === 'structure', text:
    "Le stop va sous le plus BAS de TOUTES les bougies du motif — pause comprise — et au-dessus du "
    + "plus HAUT en vente. Le risque suit donc la taille du motif et varie d'une position à l'autre." },
  { kind: 'hint', when: v => v.display !== 'level' && v.slMode === 'points', text:
    "Stop à distance fixe : le risque devient CONSTANT, et le seuil de rentabilité redevient le "
    + "1/(1+RR) des manuels." },

  { kind: 'row', when: v => v.display !== 'level', fields: [
    { kind: 'number', key: 'beTriggerR', label: 'BE — seuil (R, 0 = off)', min: 0,    max: 20, step: 0.1 },
    { kind: 'number', key: 'beLevelR',   label: 'BE — blocage (R)',        min: -0.9, max: 20, step: 0.1 },
  ] },
  { kind: 'row', when: v => v.display !== 'level', fields: [
    { kind: 'number', key: 'skipAfterTp', label: 'Signaux ignorés après un TP', min: 0, max: 100, step: 1 },
    { kind: 'number', key: 'spreadPts',   label: 'Spread (points)', min: 0, max: 10000, step: 0.1 },
  ] },
  { kind: 'toggle', key: 'uniqueTrade', label: 'Trade unique', when: v => v.display !== 'level' },
  { kind: 'hint', when: v => v.display !== 'level' && v.uniqueTrade === true, text:
    "⚠ Filtre NON NEUTRE : il écarte des signaux selon ce que le marché a fait entre-temps. Compare "
    + "toujours les deux modes avant d'y croire." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'color', key: 'bullColor', label: 'Achat — plus bas de la pause',  tint: '#34D399' },
  { kind: 'color', key: 'bearColor', label: 'Vente — plus haut de la pause', tint: '#FB923C' },
  { kind: 'row', fields: [
    { kind: 'number', key: 'extBars', label: 'Longueur à droite (barres)', min: 0,    max: 500, step: 5 },
    { kind: 'number', key: 'opacity', label: 'Opacité',                    min: 0.05, max: 1,   step: 0.05 },
  ] },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « rev »' },
];
