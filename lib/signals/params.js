// Schéma des paramètres de SORTIE — commun à tous les motifs bâtis sur
// lib/signals/engine.js, plus les outils de validation et de grille.
//
// Le schéma génère le formulaire des pages ET valide les entrées de l'API : il
// est impossible qu'une page propose un réglage que le simulateur refuserait, ou
// l'inverse. Les bornes ne sont pas décoratives : une valeur hors bornes est
// ramenée dans la plage et SIGNALÉE (`clamped`), jamais remplacée en silence —
// sinon on optimise autre chose que ce qu'on croit tester.
//
// DÉTECTION vs SORTIES : chaque motif apporte son propre DETECT_SCHEMA (le
// motif) ; les sorties, elles, sont les mêmes partout. Deux motifs mesurés avec
// ce fichier le sont donc à règles de gestion identiques, et l'écart entre eux ne
// peut pas venir de la sortie.

export const EXIT_SCHEMA = [
  { key: 'slMarginUnit',  label: 'Marge du SL — unité',        type: 'select', def: 'pts', options: ['pts', 'atr'],
    hint: '« atr » = multiple de l’ATR des sorties, lu à la clôture de la bougie qui précède l’entrée (anti-lookahead). Le rapport reste toujours en points : l’ATR n’est qu’un mode de saisie' },
  { key: 'slMarginPts',   label: 'Marge du SL (points)',      type: 'float', def: 2,  min: 0, max: 100000, step: 0.1,
    hint: 'ajoutée sous/sur l’extrême des deux dernières bougies (motif + entrée). Le SL lui-même est STRUCTUREL : sa distance varie d’une position à l’autre. Utilisé si l’unité ci-dessus est « pts »' },
  { key: 'slMarginAtr',   label: 'Marge du SL (× ATR)',       type: 'float', def: 0.2, min: 0, max: 20, step: 0.05,
    hint: 'utilisé si l’unité ci-dessus est « atr »' },
  { key: 'slCapPts',      label: 'SL plafonné — perte max (points)', type: 'float', def: 0, min: 0, max: 1000000, step: 0.1,
    hint: '0 = désactivé. VRAI STOP, pas un break-even : solde la position dès ce nombre de points contre l’entrée, même si le SL structurel n’est pas atteint (sortie « sl »). Le stop retenu est le plus serré des deux, donc risk0 ne dépasse plus ce plafond — et c’est le seul stop actif sur la bougie d’entrée. ÉVOLUTION : absente de l’EA MT5' },

  { key: 'tpUnit',        label: 'TP — unité',                 type: 'select', def: 'pts', options: ['pts', 'atr'],
    hint: '« atr » = multiple de l’ATR des sorties, lu à la clôture de la bougie qui précède l’entrée. Le rapport reste toujours en points' },
  { key: 'tpPts',         label: 'TP (points)',               type: 'float', def: 10, min: 0.01, max: 1000000, step: 0.1,
    hint: 'utilisé si l’unité ci-dessus est « pts »' },
  { key: 'tpAtr',         label: 'TP (× ATR)',                type: 'float', def: 1, min: 0.01, max: 20, step: 0.05,
    hint: 'utilisé si l’unité ci-dessus est « atr »' },

  { key: 'exitAtrPeriod', label: 'ATR des sorties — période',  type: 'int', def: 14, min: 1, max: 100,
    hint: 'ATR de Wilder. Ne sert que si le SL ou le TP est réglé en « × ATR » ci-dessus' },

  { key: 'beTriggerUnit', label: 'BE profit — unité',          type: 'select', def: 'pts', options: ['pts', 'pct'],
    hint: '« pct » = pourcentage du TP effectif de la position (celui réellement utilisé, même si le TP est réglé en × ATR)' },
  { key: 'beTriggerPts',  label: 'BE profit — seuil (points)', type: 'float', def: 0, min: 0, max: 1000000, step: 0.1,
    hint: '0 = désactivé. Déplace le STOP au niveau BE dès ce gain (évalué dès la bougie d’entrée). Utilisé si l’unité ci-dessus est « pts »' },
  { key: 'beTriggerPct',  label: 'BE profit — seuil (% du TP)', type: 'float', def: 0, min: 0, max: 1000, step: 1,
    hint: '0 = désactivé. Utilisé si l’unité ci-dessus est « pct »' },

  { key: 'beLevelUnit',   label: 'BE — niveau : unité',        type: 'select', def: 'pts', options: ['pts', 'pct'],
    hint: '« pct » = pourcentage du TP effectif de la position' },
  { key: 'beLevelPts',    label: 'BE — niveau (points)',      type: 'float', def: 0, min: -100000, max: 100000, step: 0.1,
    hint: '0 = entrée exacte, positif = gain verrouillé, négatif = perte réduite. Borné par le stop structurel : resserre, n’élargit jamais. Utilisé si l’unité ci-dessus est « pts »' },
  { key: 'beLevelPct',    label: 'BE — niveau (% du TP)',     type: 'float', def: 0, min: -1000, max: 1000, step: 1,
    hint: 'mêmes bornes que ci-dessus, en % du TP effectif. Utilisé si l’unité ci-dessus est « pct »' },
  { key: 'beBarsTrigger', label: 'BE durée — bougies',        type: 'int',   def: 0, min: 0, max: 5000,
    hint: '0 = désactivé. Déplace le STOP au niveau BE après ce nombre de bougies en position' },
  { key: 'beSwingBars',   label: 'BE swing — bougies g/d',    type: 'int',   def: 0, min: 0, max: 50,
    hint: '0 = désactivé. 2 = swing confirmé par 2 bougies avant et 2 après. Au premier swing formé pendant la position (bas en BUY, haut en SELL), le STOP passe sous/sur ce swing, marge du SL comprise — pas au niveau BE. ÉVOLUTION : absente de l’EA MT5' },
  { key: 'beTouchTrigger', label: 'BE retours — nombre',      type: 'int',   def: 0, min: 0, max: 100,
    hint: '0 = désactivé. COUPE la position au prix d’entrée (sortie « be », gain brut nul) dès ce nombre de retours sur l’entrée — ne déplace ni le stop ni le TP. ÉVOLUTION : absente de l’EA MT5' },
  { key: 'maxBars',       label: 'Durée max (bougies)',       type: 'int',   def: 0, min: 0, max: 20000,
    hint: '0 = désactivé. Solde la position à la clôture de la Nième bougie (statut « timeout »). ÉVOLUTION : absente de l’EA MT5' },
  { key: 'uniqueTrade',   label: 'Une position à la fois',    type: 'bool',  def: false },
  { key: 'skipAfterTp',   label: 'Signaux sautés après un TP', type: 'int',  def: 0, min: 0, max: 50,
    hint: '0 = désactivé. Repos après un gain, avec recharge si le signal sauté aurait aussi gagné' },
];

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

// Produit cartésien d'une liste [clé, valeurs] — ordre des clés préservé.
export function cartesian(entries) {
  let out = [{}];
  for (const [key, values] of entries) {
    const next = [];
    for (const acc of out) for (const v of values) next.push({ ...acc, [key]: v });
    out = next;
  }
  return out;
}

// Lit une spécification de grille { clé: "1:3:0.5" | [..] } et la valide contre
// un schéma. Rejette une clé inconnue au lieu de l'ignorer : une faute de frappe
// dans un nom de paramètre doit arrêter le balayage, pas le fausser en silence.
export function buildGrid(schema, gridSpec = {}) {
  const known = new Set(schema.map(s => s.key));
  const entries = [];
  for (const [key, spec] of Object.entries(gridSpec)) {
    if (!known.has(key)) throw new Error(`paramètre inconnu dans la grille : ${key}`);
    const values = expandValues(spec);
    if (!values.length) throw new Error(`grille vide pour ${key}`);
    entries.push([key, values]);
  }
  return entries;
}
