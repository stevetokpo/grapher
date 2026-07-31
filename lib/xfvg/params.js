// xFVG — réglages : valeurs par défaut d'un côté, description du formulaire de
// l'autre. Ce fichier est la seule source de vérité des deux ; le graphe et le
// panneau Patterns le lisent, personne ne recopie une valeur ailleurs.
//
// AJOUTER UNE CONDITION AU MOTIF, c'est trois lignes, toujours les mêmes :
//   1. la règle           → dans ./detect.js — RULES si elle juge UNE bougie,
//                           ZONE_FILTERS si elle compare les motifs entre eux
//                           (et SKELETONS, mais seulement pour une FIGURE
//                           nouvelle : c'est le seul étage qui pose des bornes)
//   2. sa valeur neutre   → DETECT_DEFAULTS ici (neutre = règle éteinte)
//   3. son champ          → FIELDS ici, avec un `when` si elle ne vaut que pour
//                           un mode
// Rien d'autre à toucher : le panneau se dessine à partir de FIELDS, et le
// graphe passe DETECT_DEFAULTS au détecteur. C'est ce qui évite au motif de
// devenir le bloc de 250 lignes que le rFVG a fini par être dans PatternPanel.

// ── Détection ────────────────────────────────────────────────────────────────
// Ce que lit ./detect.js, et rien de plus. Une valeur à 0 / false = filtre
// éteint : les défauts ci-dessous donnent donc le motif NU (imbalance simple),
// et chaque condition s'allume ensuite une par une.
export const DETECT_DEFAULTS = {
  // Quelle figure on cherche. 'x3' = l'imbalance 3 bougies (le motif d'origine),
  // 'x2' = le retournement contra-MM en 2 bougies. Un mode ne filtre pas
  // l'autre : chacun a son squelette et ses règles dans ./detect.js, et les
  // réglages du mode inactif sont simplement ignorés.
  mode:      'x3',
  direction: 'both',
  minPts:    0,       // gap minimum, SIGNÉ — 0 = vide strict, négatif = tolère le chevauchement
  atrPeriod: 14,      // commun aux deux modes
  // ── Mode 'x3' — l'imbalance ────────────────────────────────────────────────
  atrMult:   1.5,     // 2e bougie : taille >= x × ATR       (0 = off)
  sizeMode:  'range', // ... mesurée en amplitude ou en corps
  atrMult3:  0,       // 3e bougie : corps <= x × ATR        (0 = off)
  wick3:     false,   // 3e bougie : mèche de rejet > corps  (false = off)
  // ── Mode 'x2' — le retournement contra-MM ──────────────────────────────────
  // Clés PROPRES au mode, et pas un partage des quatre du dessus : les deux
  // figures ne se calibrent pas pareil (ici le corps, et une respiration
  // obligatoirement bridée à 0,3 × ATR ; là-haut l'amplitude, et une respiration
  // libre par défaut). Partager les clés aurait forcé l'un des deux modes à
  // démarrer hors de sa définition, et fait que régler un mode dérègle l'autre.
  x2MaPeriod:   200,    // MM que l'impulsion doit dépasser de part en part (0 = off)
  x2SizeMode:   'body', // impulsion : taille mesurée en corps ou en amplitude
  x2AtrMult:    1.5,    // impulsion  : taille >= x × ATR   (0 = off)
  x2BreathMult: 0.3,    // respiration : corps <= x × ATR   (0 = off)
  // La FORME des deux bougies, en regard de leur TAILLE ci-dessus : corps rapporté
  // à l'amplitude, donc sans référence extérieure. 1 = pleine sans mèche, 0 = doji.
  // Une bougie peut être grosse et pleine de mèches, ou minuscule et parfaitement
  // pleine — les deux mesures se cumulent, elles ne se remplacent pas.
  x2ImpulseRatio: 0,    // impulsion  : corps/amplitude >= x — 0 = off
  x2BreathRatio:  1,    // respiration : corps/amplitude <= x — 1 = off
  // La respiration est de sens CONTRAIRE par défaut. x2AllowSame ouvre en plus
  // celles qui vont dans le sens du motif, à condition d'être quasi sans corps :
  // elles ne rendent pas de terrain, mais elles n'en reprennent pas non plus.
  x2AllowSame:  false,  // maître : false = sens contraire exigé, comme avant
  x2SameRatio:  0.1,    // ... sinon corps/amplitude <= ce ratio (0,1 = 10 % de corps)
  // Imbalance optionnelle : exiger en plus un vide entre la bougie qui PRÉCÈDE
  // l'impulsion et la respiration — la mesure du mode 'x3', mais posée en
  // condition, sans toucher à la boîte. Son propre seuil, parce que `minPts` est
  // déjà pris ici par la géométrie de la zone : deux vides différents à mesurer,
  // donc deux réglages, sinon l'un des deux mentirait.
  x2Imb:        false,  // maître : false = aucune imbalance exigée
  x2ImbMinPts:  0,      // hauteur du vide, SIGNÉE — 0 = vide strict, négatif = tolère le chevauchement
  // Filtre liqxFVG — ne garder que les motifs précédés d'un motif INVERSE tout
  // proche, et le partenaire qui les a qualifiés. Compare les motifs entre eux,
  // donc second étage (ZONE_FILTERS) et non règle par bougie.
  liq:          false, // maître : false = tous les motifs passent
  liqMaxBars:   10,    // écart horizontal max entre les deux impulsions, en barres
  // Écart VERTICAL max entre les deux boîtes, en ATR et SIGNÉ — même convention
  // que minPts : 0 = elles doivent au moins se toucher, négatif = elles doivent
  // s'emmêler d'au moins cette hauteur, positif = on tolère du vide entre elles.
  liqMaxSepAtr: 0,
  // La pince sans gap a vécu ici quelques heures, sous `liqNoGap`. Elle est
  // partie dans son propre pattern (lib/liq) : sans déséquilibre à trouver, ce
  // n'était plus un xFVG, et elle méritait ses propres réglages plutôt que
  // d'emprunter ceux-ci. Ne pas la réintroduire ici — elle serait dessinée deux
  // fois.
  // Dessin seul : combien de barres la boîte est tirée à droite. Le détecteur
  // en a besoin pour poser endTime, mais ça ne change AUCUN motif retenu — à
  // exclure de toute clé de cache de signaux, comme le fait déjà le KO.
  extLen:    20,
};

// ── Habillage ────────────────────────────────────────────────────────────────
// Ce que lit la primitive de rendu. Séparé de la détection pour que changer une
// couleur ne compte jamais comme un changement de motif.
export const STYLE_DEFAULTS = {
  bullColor: '#26A69A',
  bearColor: '#EF5350',
  opacity:   0.18,
  showLabel: true,
};

export const XFVG_DEFAULTS = { ...DETECT_DEFAULTS, ...STYLE_DEFAULTS };

// Extrait les seules options de détection d'un objet de réglages du panneau —
// qui trimballe aussi le type, la couleur, `enabled`… Passer l'objet entier au
// détecteur marcherait, mais on perdrait la garantie qu'un changement de style
// ne peut pas déplacer une zone.
export function detectOptions(pat = {}) {
  const out = {};
  for (const k of Object.keys(DETECT_DEFAULTS)) {
    out[k] = pat[k] ?? DETECT_DEFAULTS[k];
  }
  return out;
}

export function styleOptions(pat = {}) {
  return {
    bullColor: pat.bullColor ?? STYLE_DEFAULTS.bullColor,
    bearColor: pat.bearColor ?? STYLE_DEFAULTS.bearColor,
    opacity:   pat.opacity   ?? STYLE_DEFAULTS.opacity,
    showLabel: pat.showLabel !== false,
    labelText: 'xFVG',
  };
}

// ── Formulaire ───────────────────────────────────────────────────────────────
// Description déclarative, rendue par <SchemaForm> (components/PatternPanel.js).
// Types : 'segmented' | 'number' | 'toggle' | 'color' | 'row' | 'divider' | 'hint'.
// `when: v => …` masque un champ selon les réglages courants, pour replier une
// couche entière derrière son interrupteur au lieu d'afficher des réglages qui ne
// pilotent rien.
const isX3 = v => v.mode !== 'x2';
const isX2 = v => v.mode === 'x2';

export const FIELDS = [
  { kind: 'segmented', key: 'mode', label: 'Figure cherchée', options: [
    { value: 'x3', label: '3 bougies' },
    { value: 'x2', label: '2 bougies' },
  ] },
  { kind: 'hint', when: isX3, text:
    "Imbalance simple en 3 bougies : une 2e bougie directionnelle assez large, qui laisse un "
    + "écart entre la 1re et la 3e. Aucune moyenne mobile n'entre en jeu — pas de retournement à "
    + "qualifier, pas de sous-familles : une zone est une zone." },
  { kind: 'hint', when: isX2, text:
    "Retournement en 2 bougies, sans imbalance : une impulsion large entièrement du MAUVAIS côté "
    + "de la MM (haussière sous la MM, baissière au-dessus), puis une petite bougie de sens "
    + "CONTRAIRE. La zone est ce qui reste du corps de l'impulsion que cette petite bougie n'a pas "
    + "repris." },

  { kind: 'segmented', key: 'direction', label: 'Direction', options: [
    { value: 'bull', label: '↑ Haussier' },
    { value: 'both', label: '↕ Les deux' },
    { value: 'bear', label: '↓ Baissier' },
  ] },
  { kind: 'hint', when: isX2, text:
    "Le sens du motif est celui de l'IMPULSION : haussier = impulsion haussière sous la MM." },

  // ── Mode 3 bougies ─────────────────────────────────────────────────────────

  { kind: 'divider', when: isX3, label: '2e bougie — l’impulsion' },

  { kind: 'segmented', when: isX3, key: 'sizeMode', label: 'Mesure de la taille', options: [
    { value: 'range', label: 'Amplitude (H−B)' },
    { value: 'body',  label: 'Corps (|C−O|)' },
  ] },
  { kind: 'row', when: isX3, fields: [
    { kind: 'number', key: 'atrPeriod', label: 'Période ATR',            min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'atrMult',   label: 'Taille ≥ ATR × (0 = off)', min: 0, max: 20,  step: 0.1 },
  ] },
  { kind: 'hint', when: isX3, text:
    "L'ATR est lu sur la bougie qui PRÉCÈDE l'impulsion, sinon il contiendrait déjà la bougie à "
    + "qualifier. Plus haut = déplacements plus violents, moins de signaux." },

  { kind: 'divider', when: isX3, label: '3e bougie — la respiration' },

  { kind: 'number', when: isX3, key: 'atrMult3', label: 'Corps ≤ ATR × (0 = off)', min: 0, max: 20, step: 0.1 },
  { kind: 'hint', when: isX3, text:
    "Impose une 3e bougie petite : son corps |clôture−ouverture| doit rester sous ce multiple de "
    + "l'ATR, lu cette fois sur l'impulsion. Toujours le corps, même en mesure « Amplitude »." },

  { kind: 'toggle', when: isX3, key: 'wick3', label: 'Mèche de rejet' },
  { kind: 'hint', when: isX3, text:
    "La mèche de la 3e bougie du côté d'où vient le motif doit dépasser son corps : mèche BASSE > "
    + "corps sur un motif haussier, mèche HAUTE > corps sur un baissier. Avec le réglage "
    + "ci-dessus, ça exige un marteau (haussier) ou une étoile filante (baissier)." },

  // ── Mode 2 bougies ─────────────────────────────────────────────────────────

  { kind: 'divider', when: isX2, label: '1re bougie — l’impulsion' },

  { kind: 'number', when: isX2, key: 'x2MaPeriod', label: 'MM — période (0 = off)', min: 0, max: 400, step: 1 },
  { kind: 'hint', when: isX2, text:
    "L'impulsion doit être ENTIÈREMENT du côté opposé à son sens par rapport à cette moyenne "
    + "mobile, mèches comprises : haut < MM pour une haussière, bas > MM pour une baissière. "
    + "C'est cette condition seule qui fait un retournement plutôt qu'une grosse bougie ordinaire. "
    + "À 0, le filtre s'éteint et il ne reste que les deux conditions de taille." },

  { kind: 'segmented', when: isX2, key: 'x2SizeMode', label: 'Mesure de la taille', options: [
    { value: 'body',  label: 'Corps (|C−O|)' },
    { value: 'range', label: 'Amplitude (H−B)' },
  ] },
  { kind: 'row', when: isX2, fields: [
    { kind: 'number', key: 'atrPeriod', label: 'Période ATR',            min: 1, max: 200, step: 1 },
    { kind: 'number', key: 'x2AtrMult', label: 'Taille ≥ ATR × (0 = off)', min: 0, max: 20, step: 0.1 },
  ] },

  { kind: 'number', when: isX2, key: 'x2ImpulseRatio', label: 'Corps / amplitude ≥ (0 = off)', min: 0, max: 1, step: 0.05 },
  { kind: 'hint', when: isX2, text:
    "Sa FORME, à côté de sa taille : elle est PLEINE, elle a poussé sans se faire repousser. "
    + "0,9 = au plus 10 % de mèche, 1 = aucune. Indépendant du seuil en ATR — une bougie peut être "
    + "énorme et pleine de mèches, ou minuscule et parfaitement pleine. Les deux se cumulent." },

  { kind: 'divider', when: isX2, label: '2e bougie — la respiration' },

  { kind: 'number', when: isX2, key: 'x2BreathMult', label: 'Corps ≤ ATR × (0 = off)', min: 0, max: 20, step: 0.05 },
  { kind: 'hint', when: isX2, text:
    "Ce seuil ne dit que sa taille — corps sous ce multiple de l'ATR. Un SEUL ATR sert aux deux "
    + "bougies, lu avant l'impulsion : sinon la respiration paraîtrait petite juste parce que "
    + "l'impulsion a gonflé la référence." },

  { kind: 'number', when: isX2, key: 'x2BreathRatio', label: 'Corps / amplitude ≤ (1 = off)', min: 0, max: 1, step: 0.05 },
  { kind: 'hint', when: isX2, text:
    "Sa FORME : elle est INDÉCISE, surtout de la mèche. 0,3 = au plus 30 % de corps. S'applique "
    + "aux DEUX sens, contrairement au ratio de l'option ci-dessous qui ne juge que les "
    + "respirations de même sens — quand les deux sont actifs sur une même bougie, c'est le plus "
    + "strict qui décide." },

  { kind: 'toggle', when: isX2, key: 'x2AllowSame', label: 'Tolérer le même sens' },
  { kind: 'hint', when: isX2, text:
    "Par défaut la respiration doit aller à CONTRE-SENS de l'impulsion. Activé, on accepte aussi "
    + "celles qui repartent dans le sens du motif — mais seulement si elles n'ont quasiment pas de "
    + "corps. Une bougie sans corps ne rend pas de terrain, mais elle n'en reprend pas non plus." },

  { kind: 'number', when: v => isX2(v) && v.x2AllowSame === true, key: 'x2SameRatio',
    label: 'Corps / amplitude ≤', min: 0, max: 1, step: 0.01 },
  { kind: 'hint', when: v => isX2(v) && v.x2AllowSame === true, text:
    "Ne s'applique QU'AUX respirations de même sens : 0,1 = au plus 10 % de corps, donc presque "
    + "rien que de la mèche. Celles de sens contraire ne sont jamais jugées là-dessus, seulement "
    + "sur leur taille. Un doji passe ici aussi : il n'a pas de sens à opposer, mais son corps nul "
    + "en fait le comble de l'indécision." },

  { kind: 'divider', when: isX2, label: 'Imbalance — optionnelle' },

  { kind: 'toggle', when: isX2, key: 'x2Imb', label: 'Exiger un vide' },
  { kind: 'hint', when: isX2, text:
    "Rajoute la condition du mode 3 bougies : il doit rester un VIDE entre la bougie qui PRÉCÈDE "
    + "l'impulsion et la respiration — l'impulsion a sauté par-dessus les deux. Exactement la même "
    + "mesure qu'en mode 3 bougies, mais ici elle ne fait que qualifier le motif : la zone reste le "
    + "corps d'impulsion non repris, elle ne devient pas ce vide. Et elle s'ajoute à la MM et au "
    + "sens imposé de la respiration, que le mode 3 bougies n'exige pas." },

  { kind: 'number', when: v => isX2(v) && v.x2Imb === true, key: 'x2ImbMinPts',
    label: 'Vide min (points, signé)', min: -100000, max: 100000, step: 0.1 },
  { kind: 'hint', when: v => isX2(v) && v.x2Imb === true, text:
    "0 = vide strict. NÉGATIF = on tolère que les deux bougies se chevauchent jusqu'à cette "
    + "profondeur. Réglage distinct du « Gap min » plus bas, qui lui mesure la zone dessinée : ce "
    + "sont deux vides différents." },

  // ── Commun ─────────────────────────────────────────────────────────────────

  { kind: 'divider', label: 'Zone' },

  { kind: 'row', fields: [
    { kind: 'number', key: 'minPts', label: 'Gap min (points, signé)', min: -100000, max: 100000, step: 0.1 },
    { kind: 'number', key: 'extLen', label: 'Extension (barres)',      min: 1,       max: 500,    step: 1 },
  ] },
  { kind: 'hint', when: isX3, text:
    "Gap min à 0 = vide strict entre la 1re et la 3e bougie (le FVG classique). NÉGATIF = on "
    + "accepte qu'elles se chevauchent jusqu'à cette profondeur, et la zone devient leur bande "
    + "commune. Un gap exactement nul est toujours rejeté : la boîte serait plate." },
  { kind: 'hint', when: isX2, text:
    "Ici le « gap » est la hauteur de corps d'impulsion que la respiration n'a PAS reprise. À 0, "
    + "il suffit qu'elle s'arrête avant l'ouverture de l'impulsion. NÉGATIF = on accepte qu'elle "
    + "la dépasse de cette profondeur, et la zone devient leur bande commune. Un écart exactement "
    + "nul est toujours rejeté : la boîte serait plate." },

  { kind: 'divider', label: 'Filtre liqxFVG' },

  { kind: 'toggle', key: 'liq', label: 'N’afficher que les liqxFVG' },
  { kind: 'hint', text:
    "Un liqxFVG est un xFVG précédé d'un motif de sens INVERSE tout proche : quelques bougies "
    + "derrière lui, et à portée verticale. Les deux boîtes forment une pince autour du même prix. "
    + "La PAIRE reste affichée — le motif retenu porte l'étiquette « liqxFVG », le motif opposé qui "
    + "l'a qualifié garde « xFVG », pour qu'on voie lequel a déclenché." },

  { kind: 'row', when: v => v.liq === true, fields: [
    { kind: 'number', key: 'liqMaxBars',   label: 'Écart max (barres)',    min: 1,  max: 500, step: 1 },
    { kind: 'number', key: 'liqMaxSepAtr', label: 'Écart vert. ≤ ATR ×',   min: -5, max: 5,   step: 0.05 },
  ] },
  { kind: 'hint', when: v => v.liq === true, text:
    "L'écart vertical est SIGNÉ, comme le gap min : 0 = les deux boîtes doivent au moins se "
    + "toucher, NÉGATIF = elles doivent s'emmêler d'au moins cette hauteur (−0,5 = un demi-ATR de "
    + "chevauchement), positif = on tolère du vide entre elles. En ATR, donc le réglage tient d'un "
    + "symbole à l'autre. L'écart en barres se compte d'une impulsion à l'autre." },

  { kind: 'hint', when: v => v.liq === true, text:
    "La pince SANS gap — impulsion, respiration, impulsion inverse — a son propre pattern « liq » "
    + "dans la liste, avec ses propres réglages. Elle ne se règle plus ici." },

  { kind: 'divider', label: 'Affichage' },

  { kind: 'color',  key: 'bullColor', label: 'Couleur haussière', tint: '#26A69A' },
  { kind: 'color',  key: 'bearColor', label: 'Couleur baissière', tint: '#EF5350' },
  { kind: 'number', key: 'opacity',   label: 'Opacité', min: 0.02, max: 1, step: 0.02 },
  { kind: 'toggle', key: 'showLabel', label: 'Étiquette « xFVG »' },
];
