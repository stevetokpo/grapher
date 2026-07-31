// Thème du graphe : source unique des réglages d'apparence.
//
// Ce module ne dépend PAS de lightweight-charts : il rend des valeurs
// sémantiques (chaînes, couleurs CSS) que TradingChart traduit en énumérations
// LWC. C'est ce qui permet à pages/index.js d'importer les réglages par défaut
// sans tirer la librairie de graphe dans le bundle principal — et au panneau de
// réglages de dessiner son aperçu SVG avec exactement les mêmes couleurs que le
// vrai graphe.

// ── Fonds ────────────────────────────────────────────────────────────────────
// `grid` / `wm` sont des triplets RGB : l'opacité est appliquée au moment du
// rendu, à partir des réglages. `gridK` compense le fait qu'une grille lisible
// sur fond clair demande beaucoup plus d'alpha que sur fond noir.
export const BG_PRESETS = {
  midnight: {
    label: 'Minuit', dark: true,
    top: '#0E1422', bottom: '#080B13',
    grid: '148,163,184', gridK: 0.16,
    text: '#7C8AA5', border: '#243155',
    crosshair: '#94A3B8', crossLabel: '#1E293B',
    wm: '226,232,240', wmK: 0.05,
  },
  slate: {
    label: 'Ardoise', dark: true,
    top: '#18202F', bottom: '#111825',
    grid: '203,213,225', gridK: 0.15,
    text: '#8C9AB4', border: '#2B3852',
    crosshair: '#A3B1C6', crossLabel: '#27344A',
    wm: '226,232,240', wmK: 0.05,
  },
  carbon: {
    label: 'Carbone', dark: true,
    top: '#141416', bottom: '#0A0A0C',
    grid: '161,161,170', gridK: 0.15,
    text: '#8B8B94', border: '#2C2C31',
    crosshair: '#A1A1AA', crossLabel: '#26262B',
    wm: '244,244,245', wmK: 0.045,
  },
  abyss: {
    label: 'Abysse', dark: true,
    top: '#050608', bottom: '#000000',
    grid: '148,163,184', gridK: 0.13,
    text: '#6B7A93', border: '#1B2434',
    crosshair: '#8794AB', crossLabel: '#141C29',
    wm: '226,232,240', wmK: 0.045,
  },
  paper: {
    label: 'Papier', dark: false,
    top: '#FDFDFE', bottom: '#EFF2F7',
    grid: '71,85,105', gridK: 0.30,
    text: '#5A6B85', border: '#C7D0DD',
    crosshair: '#475569', crossLabel: '#334155',
    wm: '15,23,42', wmK: 0.07,
  },
};

// ── Couples haussier / baissier ──────────────────────────────────────────────
// Écarts mesurés avec le validateur de palette du skill dataviz (ΔE OKLab ×100,
// simulation deutan/protan). Le couple classique passe mais reste le plus
// faible en deutéranopie (ΔE 11,6) : d'où le préréglage « Daltonien », qui monte
// à ~28 en séparant sur la teinte bleu/orange plutôt que vert/rouge.
export const COLOR_PRESETS = [
  { id: 'classic', label: 'Classique',  bull: '#26A69A', bear: '#EF5350' },
  { id: 'neon',    label: 'Néon',       bull: '#00E5A0', bear: '#FF3B69' },
  { id: 'cvd',     label: 'Daltonien',  bull: '#4C9BF5', bear: '#DE8A16' },
  { id: 'ink',     label: 'Encre',      bull: '#D6DEEA', bear: '#5C6B85' },
  { id: 'dusk',    label: 'Crépuscule', bull: '#F5B14C', bear: '#8B7BF0' },
];

export const CANDLE_COLORS = [
  '#26A69A', '#34D399', '#4ADE80', '#22C55E',
  '#EF5350', '#F87171', '#FB923C', '#F59E0B',
  '#60A5FA', '#A78BFA', '#F472B6', '#94A3B8',
];

// ── Réglages par défaut ──────────────────────────────────────────────────────
export const DEFAULT_CHART_SETTINGS = {
  // Bougies
  bullColor:      '#26A69A',
  bearColor:      '#EF5350',
  candleBody:     'filled',   // filled | hollowUp | hollow
  candleBorders:  true,
  wickVisible:    true,
  wickTint:       'body',     // body | neutral
  barSpacing:     8,

  // Volume
  showVolume:     true,
  volumeOpacity:  0.45,
  volumeHeight:   0.20,

  // Fond & grille
  bgPreset:       'midnight',
  bgGradient:     true,
  vignette:       true,
  gridHorz:       true,
  gridVert:       true,
  gridStyle:      'solid',    // solid | dotted | dashed
  gridOpacity:    0.45,

  // Curseur
  crosshair:      'normal',   // normal | magnet | hidden
  crosshairStyle: 'dashed',   // solid | dotted | dashed | largeDashed

  // Échelles & axes
  priceScale:     true,
  priceScaleMode: 'normal',   // normal | log | percent
  axisBorders:    true,
  axisFont:       'mono',     // mono | sans
  axisFontSize:   11,
  lastPriceLine:  true,
  timeSeconds:    false,
  rightOffset:    6,

  // Filigrane
  watermark:      true,
  watermarkSize:  46,

  // Chargement
  initialBars:    500,
  barsPerScroll:  500,

  // Footprint
  fpImbalanceRatio: 3,
};

// ── Ambiances complètes ──────────────────────────────────────────────────────
// Un clic = un lot cohérent de réglages. Les couleurs de bougies ne sont PAS
// touchées : c'est le seul choix vraiment personnel, on ne l'écrase pas.
export const THEME_PRESETS = [
  {
    id: 'terminal', label: 'Terminal',
    desc: 'Grille dense, chiffres monospace, volume marqué',
    patch: {
      bgPreset: 'midnight', bgGradient: false, vignette: false,
      gridHorz: true, gridVert: true, gridStyle: 'solid', gridOpacity: 0.55,
      candleBody: 'filled', candleBorders: true, wickTint: 'body',
      axisFont: 'mono', axisFontSize: 11, axisBorders: true,
      volumeOpacity: 0.5, volumeHeight: 0.20, crosshairStyle: 'dashed',
    },
  },
  {
    id: 'zen', label: 'Zen',
    desc: 'Fond dégradé, grille effacée, mèches neutres',
    patch: {
      bgPreset: 'midnight', bgGradient: true, vignette: true,
      gridHorz: true, gridVert: false, gridStyle: 'dotted', gridOpacity: 0.35,
      candleBody: 'filled', candleBorders: false, wickTint: 'neutral',
      axisFont: 'sans', axisFontSize: 11, axisBorders: false,
      volumeOpacity: 0.28, volumeHeight: 0.16, crosshairStyle: 'dotted',
    },
  },
  {
    id: 'hollow', label: 'Contraste',
    desc: 'Corps creux à la hausse, bordures vives, fond noir',
    patch: {
      bgPreset: 'abyss', bgGradient: false, vignette: true,
      gridHorz: true, gridVert: false, gridStyle: 'dashed', gridOpacity: 0.4,
      candleBody: 'hollowUp', candleBorders: true, wickTint: 'body',
      axisFont: 'mono', axisFontSize: 11, axisBorders: true,
      volumeOpacity: 0.4, volumeHeight: 0.18, crosshairStyle: 'solid',
    },
  },
  {
    id: 'paper', label: 'Papier',
    desc: 'Fond clair, grille fine — pour l\'impression et les captures',
    patch: {
      bgPreset: 'paper', bgGradient: true, vignette: false,
      gridHorz: true, gridVert: true, gridStyle: 'solid', gridOpacity: 0.4,
      candleBody: 'hollowUp', candleBorders: true, wickTint: 'body',
      axisFont: 'sans', axisFontSize: 11, axisBorders: true,
      volumeOpacity: 0.35, volumeHeight: 0.18, crosshairStyle: 'dashed',
    },
  },
];

// ── Utilitaires couleur ──────────────────────────────────────────────────────
export function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (isNaN(n) || full.length !== 6) return `rgba(148,163,184,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const TRANSPARENT = 'rgba(0,0,0,0)';

/**
 * Traduit les réglages utilisateur en un thème exploitable, à la fois par
 * lightweight-charts (TradingChart) et par un rendu SVG (l'aperçu du panneau).
 */
export function resolveChartTheme(raw) {
  const s  = { ...DEFAULT_CHART_SETTINGS, ...(raw || {}) };
  const bg = BG_PRESETS[s.bgPreset] || BG_PRESETS.midnight;

  const gridAlpha = Math.max(0, Math.min(1, s.gridOpacity)) * bg.gridK;
  const gridColor = `rgba(${bg.grid},${gridAlpha.toFixed(3)})`;

  // Corps creux : LWC dessine un corps transparent, seule la bordure porte la
  // couleur — donc les bordures redeviennent obligatoires.
  const hollowUp   = s.candleBody === 'hollow' || s.candleBody === 'hollowUp';
  const hollowDown = s.candleBody === 'hollow';
  const borders    = s.candleBorders || hollowUp || hollowDown;

  const neutralWick = bg.dark ? `rgba(${bg.grid},0.72)` : 'rgba(71,85,105,0.75)';
  const wickUp   = s.wickTint === 'neutral' ? neutralWick : s.bullColor;
  const wickDown = s.wickTint === 'neutral' ? neutralWick : s.bearColor;

  // Le fond est porté par un div DOM (le canvas LWC est transparent) : on peut
  // donc empiler un dégradé et une vignette, ce que LWC ne sait pas faire.
  const layers = [];
  if (s.vignette) {
    layers.push(
      `radial-gradient(ellipse 120% 100% at 50% 42%, rgba(0,0,0,0) 52%, ${bg.dark ? 'rgba(0,0,0,0.42)' : 'rgba(100,116,139,0.16)'} 100%)`,
    );
  }
  layers.push(
    s.bgGradient
      ? `linear-gradient(180deg, ${bg.top} 0%, ${bg.bottom} 100%)`
      : `linear-gradient(${bg.bottom}, ${bg.bottom})`,
  );

  return {
    dark: bg.dark,
    bg: {
      css:    layers.join(', '),
      solid:  bg.bottom,
      // Bornes du dégradé — reprises telles quelles pour peindre le fond des
      // captures d'écran. Sans dégradé, les deux bornes se confondent.
      top:    s.bgGradient ? bg.top : bg.bottom,
      bottom: bg.bottom,
    },
    layout: {
      textColor:  bg.text,
      fontSize:   s.axisFontSize,
      fontFamily: s.axisFont === 'mono'
        ? "'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace"
        : 'Inter, system-ui, sans-serif',
    },
    grid: {
      color: gridColor,
      style: s.gridStyle,
      horz:  s.gridHorz,
      vert:  s.gridVert,
    },
    crosshair: {
      mode:     s.crosshair,
      style:    s.crosshairStyle,
      color:    hexToRgba(bg.crosshair, bg.dark ? 0.45 : 0.55),
      labelBg:  bg.crossLabel,
    },
    axis: {
      visible:      s.priceScale,
      mode:         s.priceScaleMode,
      borderColor:  bg.border,
      borderVisible: s.axisBorders,
      textColor:    bg.text,
      secondsVisible: s.timeSeconds,
      rightOffset:  s.rightOffset,
      barSpacing:   s.barSpacing,
    },
    watermark: {
      visible:  s.watermark,
      color:    `rgba(${bg.wm},${bg.wmK})`,
      fontSize: s.watermarkSize,
    },
    candle: {
      upColor:         hollowUp   ? TRANSPARENT : s.bullColor,
      downColor:       hollowDown ? TRANSPARENT : s.bearColor,
      borderVisible:   borders,
      borderUpColor:   s.bullColor,
      borderDownColor: s.bearColor,
      wickVisible:     s.wickVisible,
      wickUpColor:     wickUp,
      wickDownColor:   wickDown,
      priceLineVisible: s.lastPriceLine,
      lastValueVisible: s.lastPriceLine,
      // Couleurs « pleines » — l'aperçu et les légendes en ont besoin même
      // quand le corps est creux.
      bull: s.bullColor,
      bear: s.bearColor,
    },
    volume: {
      visible:  s.showVolume,
      height:   Math.max(0.05, Math.min(0.45, s.volumeHeight)),
      upColor:   hexToRgba(s.bullColor, s.volumeOpacity),
      downColor: hexToRgba(s.bearColor, s.volumeOpacity),
    },
  };
}
