// Schéma des paramètres rFVG — génère le formulaire de la page ET valide les
// entrées de l'API. Les bornes ne sont pas décoratives : une valeur hors bornes
// est ramenée dans la plage et SIGNALÉE (`clamped`), jamais remplacée en
// silence — sinon on optimise autre chose que ce qu'on croit tester.
//
// DÉTECTION vs SORTIES : la séparation est la clé de l'optimiseur. La détection
// est figée par l'utilisateur (c'est son motif, pas une variable libre) ; seules
// les sorties sont balayées. Ajouter la détection à la grille ferait sauter le
// budget de liberté (~30 positions par paramètre réglé) en deux paramètres.

export const DETECT_SCHEMA = [
  { key: 'mode',         label: 'Motifs retenus',          type: 'select', def: 'rfvg', options: ['rfvg', 'all', 'super'],
    hint: 'rfvg = centrale à contre-courant des deux MM ; all = tout motif de base (aFVG inclus) ; super = les rFVG dont la 3e bougie clôture à contre-sens' },
  { key: 'direction',    label: 'Direction',               type: 'select', def: 'both', options: ['both', 'bull', 'bear'] },
  { key: 'maPeriodFast', label: 'MM rapide',               type: 'int',   def: 15,  min: 2, max: 400 },
  { key: 'maPeriodSlow', label: 'MM lente',                type: 'int',   def: 200, min: 2, max: 400,
    hint: 'la centrale doit être entièrement du bon côté des DEUX MM à la fois' },
  { key: 'sizeMode',     label: 'Mesure de la centrale',   type: 'select', def: 'range', options: ['range', 'body'] },
  { key: 'atrPeriod',    label: 'ATR — période',           type: 'int',   def: 14, min: 1, max: 100 },
  { key: 'atrMult',      label: 'Centrale ≥ ATR ×',        type: 'float', def: 1.5, min: 0, max: 10, step: 0.1, hint: '0 = filtre de taille désactivé' },
  { key: 'atrMult3',     label: 'Corps 3e bougie ≤ ATR ×', type: 'float', def: 0,   min: 0, max: 10, step: 0.1, hint: '0 = désactivé' },
  { key: 'wick3',        label: 'Mèche de rejet 3e bougie', type: 'bool', def: false },
  { key: 'minPts',       label: 'Gap minimum (prix, signé)', type: 'float', def: 0, min: -100000, max: 100000, step: 0.1,
    hint: '0 = vrai vide entre 1re et 3e bougie ; négatif = accepte le chevauchement' },
];

export const EXIT_SCHEMA = [
  { key: 'slMarginPts',   label: 'Marge du SL (points)',      type: 'float', def: 2,  min: 0, max: 100000, step: 0.1,
    hint: 'ajoutée sous/sur l’extrême B3-B4. Le SL lui-même est STRUCTUREL : sa distance varie d’une position à l’autre' },
  { key: 'tpPts',         label: 'TP (points)',               type: 'float', def: 10, min: 0.01, max: 1000000, step: 0.1 },
  { key: 'beTriggerPts',  label: 'BE profit — seuil (points)', type: 'float', def: 0, min: 0, max: 1000000, step: 0.1,
    hint: '0 = désactivé. Déplace le STOP au niveau BE dès ce gain (évalué dès B4)' },
  { key: 'beLevelPts',    label: 'BE — niveau (points)',      type: 'float', def: 0, min: -100000, max: 100000, step: 0.1,
    hint: '0 = entrée exacte, positif = gain verrouillé, négatif = perte réduite. Borné par le stop structurel : resserre, n’élargit jamais' },
  { key: 'beBarsTrigger', label: 'BE durée — bougies',        type: 'int',   def: 0, min: 0, max: 5000,
    hint: '0 = désactivé. Déplace le STOP au niveau BE après ce nombre de bougies en position' },
  { key: 'beTouchTrigger', label: 'BE retours — nombre',      type: 'int',   def: 0, min: 0, max: 100,
    hint: '0 = désactivé. Déplace le TP au miroir du SL (objectif 1R) après ce nombre de retours sur l’entrée' },
  { key: 'maxBars',       label: 'Durée max (bougies)',       type: 'int',   def: 0, min: 0, max: 20000,
    hint: '0 = désactivé. Solde la position à la clôture de la Nième bougie (statut « timeout »). ÉVOLUTION : absente de l’EA MT5' },
  { key: 'uniqueTrade',   label: 'Une position à la fois',    type: 'bool',  def: false },
  { key: 'skipAfterTp',   label: 'Signaux sautés après un TP', type: 'int',  def: 0, min: 0, max: 50,
    hint: '0 = désactivé. Repos après un gain, avec recharge si le signal sauté aurait aussi gagné' },
];

export const ALL_SCHEMA = [...DETECT_SCHEMA, ...EXIT_SCHEMA];

export const defaultsOf = schema =>
  Object.fromEntries(schema.map(s => [s.key, s.def]));

// Ramène chaque valeur dans son type et ses bornes. `clamped` liste ce qui a
// bougé : à afficher, jamais à taire.
export function sanitize(schema, input = {}) {
  const out = {}, clamped = [];
  for (const s of schema) {
    const raw = input[s.key];
    if (raw === undefined || raw === null || raw === '') { out[s.key] = s.def; continue; }

    if (s.type === 'bool') { out[s.key] = raw === true || raw === 'true' || raw === 1; continue; }

    if (s.type === 'select') {
      if (!s.options.includes(raw)) { out[s.key] = s.def; clamped.push(`${s.key}: ${raw} → ${s.def}`); }
      else out[s.key] = raw;
      continue;
    }

    let v = s.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(v)) { out[s.key] = s.def; clamped.push(`${s.key}: ${raw} → ${s.def}`); continue; }
    const c = Math.min(s.max, Math.max(s.min, v));
    if (c !== v) clamped.push(`${s.key}: ${v} → ${c}`);
    out[s.key] = c;
  }
  return { params: out, clamped };
}

// Grille : "10:60:10" (début:fin:pas) ou "10,15,20" ou un tableau déjà prêt.
export function expandValues(spec) {
  if (Array.isArray(spec)) return spec;
  const s = String(spec).trim();
  if (s.includes(':')) {
    const [a, b, st] = s.split(':').map(Number);
    if (![a, b, st].every(Number.isFinite) || st === 0) throw new Error(`plage illisible : ${spec}`);
    const out = [];
    // Comparaison arrondie : 0.1 accumulé 30 fois dépasse la borne d'un
    // milliardième et perdrait silencieusement la dernière valeur.
    for (let v = a; st > 0 ? v <= b + 1e-9 : v >= b - 1e-9; v += st) out.push(+v.toFixed(6));
    return out;
  }
  return s.split(',').map(x => Number(x.trim())).filter(Number.isFinite);
}
