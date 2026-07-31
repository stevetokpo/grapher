import { useState } from 'react';
import {
  DEFAULT_CHART_SETTINGS, BG_PRESETS, COLOR_PRESETS, CANDLE_COLORS, THEME_PRESETS,
} from '../lib/chartTheme';
import ChartPreview from './charts/ChartPreview';
import styles from './SettingsPanel.module.css';

// Les réglages vivent dans lib/chartTheme (partagés avec le graphe et l'aperçu).
// Ré-export : les pages importent DEFAULT_SETTINGS d'ici depuis toujours.
export const DEFAULT_SETTINGS = DEFAULT_CHART_SETTINGS;

const BARS_MIN = 50;
const BARS_MAX = 400000;

function clampBars(raw, fallback) {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return fallback;
  return Math.min(BARS_MAX, Math.max(BARS_MIN, n));
}

function parseBarsInput(raw, fallback) {
  if (raw === '') return fallback;
  const n = parseInt(raw, 10);
  return isNaN(n) ? fallback : n;
}

// ── Briques de formulaire ────────────────────────────────────────────────────
const Field = ({ label, hint, children, inline }) => (
  <div className={inline ? styles.fieldRow : styles.field}>
    {inline ? (
      <>
        <span className={styles.label}>{label}</span>
        {children}
      </>
    ) : (
      <>
        <span className={styles.label}>{label}</span>
        {children}
        {hint && <span className={styles.hint}>{hint}</span>}
      </>
    )}
  </div>
);

const Segmented = ({ value, options, onChange }) => (
  <div className={styles.segmented}>
    {options.map(o => (
      <button
        key={o.v}
        className={`${styles.segBtn}${value === o.v ? ` ${styles.segBtnActive}` : ''}`}
        onClick={() => onChange(o.v)}
        title={o.title}
        aria-pressed={value === o.v}
      >
        {o.l}
      </button>
    ))}
  </div>
);

const Toggle = ({ on, onChange, disabled, labels = ['Activé', 'Désactivé'] }) => (
  <button
    className={`${styles.toggleBtn}${on ? ` ${styles.toggleBtnOn}` : ''}`}
    onClick={() => !disabled && onChange(!on)}
    disabled={disabled}
    aria-pressed={on}
  >
    <span className={styles.toggleTrack}><span className={styles.toggleKnob} /></span>
    {on ? labels[0] : labels[1]}
  </button>
);

const Slider = ({ value, min, max, step = 1, onChange, format }) => (
  <div className={styles.sliderRow}>
    <input
      type="range"
      className={styles.slider}
      min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
    />
    <span className={styles.sliderVal}>{format ? format(value) : value}</span>
  </div>
);

const Swatches = ({ value, onChange }) => (
  <div className={styles.colorRow}>
    {CANDLE_COLORS.map(c => (
      <button
        key={c}
        className={`${styles.swatch}${value === c ? ` ${styles.swatchActive}` : ''}`}
        style={{ '--sw': c }}
        onClick={() => onChange(c)}
        aria-label={c}
        aria-pressed={value === c}
      />
    ))}
    <label className={styles.customColor} title="Couleur personnalisée">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} />
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </label>
  </div>
);

const TABS = [
  { id: 'candles', label: 'Bougies' },
  { id: 'canvas',  label: 'Fond & grille' },
  { id: 'axes',    label: 'Axes & curseur' },
  { id: 'overlay', label: 'Volume & repères' },
  { id: 'data',    label: 'Données' },
];

const pct = v => `${Math.round(v * 100)}%`;

export default function SettingsPanel({ settings, onChange, onClose }) {
  const [tab, setTab] = useState('candles');
  const s   = { ...DEFAULT_SETTINGS, ...settings };
  const set = (patch) => onChange({ ...s, ...patch });

  const hollow = s.candleBody !== 'filled';

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <h2 id="settings-title" className={styles.title}>Réglages du graphe</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        </header>

        {/* ── Aperçu en direct ─────────────────────────────────────── */}
        <div className={styles.preview}>
          <ChartPreview settings={s} />
        </div>

        {/* ── Ambiances ────────────────────────────────────────────── */}
        <div className={styles.presetRow}>
          {THEME_PRESETS.map(p => (
            <button
              key={p.id}
              className={styles.presetBtn}
              onClick={() => set(p.patch)}
              title={p.desc}
            >
              <span
                className={styles.presetDot}
                style={{ background: `linear-gradient(135deg, ${BG_PRESETS[p.patch.bgPreset].top}, ${BG_PRESETS[p.patch.bgPreset].bottom})` }}
              />
              {p.label}
            </button>
          ))}
        </div>

        {/* ── Onglets ──────────────────────────────────────────────── */}
        <nav className={styles.tabs} role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab}${tab === t.id ? ` ${styles.tabActive}` : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className={styles.body}>

          {/* ── BOUGIES ────────────────────────────────────────────── */}
          {tab === 'candles' && (
            <>
              <Field label="Couple de couleurs">
                <div className={styles.pairRow}>
                  {COLOR_PRESETS.map(p => {
                    const active = s.bullColor === p.bull && s.bearColor === p.bear;
                    return (
                      <button
                        key={p.id}
                        className={`${styles.pairBtn}${active ? ` ${styles.pairBtnActive}` : ''}`}
                        onClick={() => set({ bullColor: p.bull, bearColor: p.bear })}
                        title={p.id === 'cvd' ? 'Séparation bleu / orange — lisible en deutéranopie et protanopie' : p.label}
                      >
                        <span className={styles.pairSwatch}>
                          <i style={{ background: p.bull }} />
                          <i style={{ background: p.bear }} />
                        </span>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <span className={styles.hint}>
                  « Daltonien » sépare sur le bleu/orange : le couple vert/rouge classique
                  se confond en deutéranopie.
                </span>
              </Field>

              <Field label={<><span className={styles.labelDot} style={{ background: s.bullColor }} />Haussière</>}>
                <Swatches value={s.bullColor} onChange={v => set({ bullColor: v })} />
              </Field>

              <Field label={<><span className={styles.labelDot} style={{ background: s.bearColor }} />Baissière</>}>
                <Swatches value={s.bearColor} onChange={v => set({ bearColor: v })} />
              </Field>

              <Field label="Corps" hint={hollow ? 'Un corps creux impose les bordures : c’est elles qui portent la couleur.' : null}>
                <Segmented
                  value={s.candleBody}
                  onChange={v => set({ candleBody: v })}
                  options={[
                    { v: 'filled',   l: 'Plein' },
                    { v: 'hollowUp', l: 'Hausse creuse' },
                    { v: 'hollow',   l: 'Tout creux' },
                  ]}
                />
              </Field>

              <Field label="Bordures" inline>
                <Toggle
                  on={s.candleBorders || hollow}
                  disabled={hollow}
                  onChange={v => set({ candleBorders: v })}
                  labels={['Visibles', 'Masquées']}
                />
              </Field>

              <Field label="Mèches" inline>
                <Toggle on={s.wickVisible} onChange={v => set({ wickVisible: v })} labels={['Visibles', 'Masquées']} />
              </Field>

              <Field label="Teinte des mèches">
                <Segmented
                  value={s.wickTint}
                  onChange={v => set({ wickTint: v })}
                  options={[
                    { v: 'body',    l: 'Couleur du corps' },
                    { v: 'neutral', l: 'Neutre' },
                  ]}
                />
              </Field>

              <Field label="Largeur des bougies" hint="Espacement initial entre deux bougies — la molette continue de zoomer librement.">
                <Slider value={s.barSpacing} min={2} max={24} onChange={v => set({ barSpacing: v })} format={v => `${v} px`} />
              </Field>
            </>
          )}

          {/* ── FOND & GRILLE ──────────────────────────────────────── */}
          {tab === 'canvas' && (
            <>
              <Field label="Fond">
                <div className={styles.bgRow}>
                  {Object.entries(BG_PRESETS).map(([id, p]) => (
                    <button
                      key={id}
                      className={`${styles.bgBtn}${s.bgPreset === id ? ` ${styles.bgBtnActive}` : ''}`}
                      onClick={() => set({ bgPreset: id })}
                      style={{ background: `linear-gradient(180deg, ${p.top}, ${p.bottom})` }}
                      title={p.label}
                    >
                      <span style={{ color: p.text }}>{p.label}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Dégradé de fond" inline>
                <Toggle on={s.bgGradient} onChange={v => set({ bgGradient: v })} />
              </Field>

              <Field label="Vignette" inline>
                <Toggle on={s.vignette} onChange={v => set({ vignette: v })} />
              </Field>

              <Field label="Lignes horizontales" inline>
                <Toggle on={s.gridHorz} onChange={v => set({ gridHorz: v })} labels={['Visibles', 'Masquées']} />
              </Field>

              <Field label="Lignes verticales" inline>
                <Toggle on={s.gridVert} onChange={v => set({ gridVert: v })} labels={['Visibles', 'Masquées']} />
              </Field>

              <Field label="Style de grille">
                <Segmented
                  value={s.gridStyle}
                  onChange={v => set({ gridStyle: v })}
                  options={[
                    { v: 'solid',  l: 'Plein' },
                    { v: 'dotted', l: 'Pointillé' },
                    { v: 'dashed', l: 'Tirets' },
                  ]}
                />
              </Field>

              <Field label="Intensité de la grille" hint="La grille est un repère, pas une donnée : elle doit rester en retrait des bougies.">
                <Slider value={s.gridOpacity} min={0} max={1} step={0.05} onChange={v => set({ gridOpacity: v })} format={pct} />
              </Field>
            </>
          )}

          {/* ── AXES & CURSEUR ─────────────────────────────────────── */}
          {tab === 'axes' && (
            <>
              <Field label="Échelle des prix" inline>
                <Toggle on={s.priceScale} onChange={v => set({ priceScale: v })} labels={['Visible', 'Masquée']} />
              </Field>

              <Field label="Type d'échelle" hint="Le log met à la même hauteur deux variations de même pourcentage.">
                <Segmented
                  value={s.priceScaleMode}
                  onChange={v => set({ priceScaleMode: v })}
                  options={[
                    { v: 'normal',  l: 'Linéaire' },
                    { v: 'log',     l: 'Log' },
                    { v: 'percent', l: '%' },
                  ]}
                />
              </Field>

              <Field label="Bordures des axes" inline>
                <Toggle on={s.axisBorders} onChange={v => set({ axisBorders: v })} labels={['Visibles', 'Masquées']} />
              </Field>

              <Field label="Police des axes">
                <Segmented
                  value={s.axisFont}
                  onChange={v => set({ axisFont: v })}
                  options={[
                    { v: 'mono', l: 'Monospace' },
                    { v: 'sans', l: 'Sans' },
                  ]}
                />
              </Field>

              <Field label="Taille du texte">
                <Slider value={s.axisFontSize} min={9} max={15} onChange={v => set({ axisFontSize: v })} format={v => `${v} px`} />
              </Field>

              <Field label="Ligne du dernier prix" inline>
                <Toggle on={s.lastPriceLine} onChange={v => set({ lastPriceLine: v })} labels={['Visible', 'Masquée']} />
              </Field>

              <Field label="Secondes sur l'axe du temps" inline>
                <Toggle on={s.timeSeconds} onChange={v => set({ timeSeconds: v })} labels={['Affichées', 'Masquées']} />
              </Field>

              <Field label="Marge à droite" hint="Espace vide gardé après la dernière bougie.">
                <Slider value={s.rightOffset} min={0} max={40} onChange={v => set({ rightOffset: v })} format={v => `${v} bougies`} />
              </Field>

              <Field label="Curseur">
                <Segmented
                  value={s.crosshair}
                  onChange={v => set({ crosshair: v })}
                  options={[
                    { v: 'normal', l: 'Libre' },
                    { v: 'magnet', l: 'Aimanté', title: 'Se colle aux prix OHLC de la bougie survolée' },
                    { v: 'hidden', l: 'Masqué' },
                  ]}
                />
              </Field>

              <Field label="Style du curseur">
                <Segmented
                  value={s.crosshairStyle}
                  onChange={v => set({ crosshairStyle: v })}
                  options={[
                    { v: 'solid',       l: 'Plein' },
                    { v: 'dotted',      l: 'Pointillé' },
                    { v: 'dashed',      l: 'Tirets' },
                    { v: 'largeDashed', l: 'Longs' },
                  ]}
                />
              </Field>
            </>
          )}

          {/* ── VOLUME & REPÈRES ───────────────────────────────────── */}
          {tab === 'overlay' && (
            <>
              <Field label="Volume" inline>
                <Toggle on={s.showVolume} onChange={v => set({ showVolume: v })} labels={['Visible', 'Masqué']} />
              </Field>

              <Field label="Opacité du volume">
                <Slider value={s.volumeOpacity} min={0.1} max={1} step={0.05} onChange={v => set({ volumeOpacity: v })} format={pct} />
              </Field>

              <Field label="Hauteur du volume" hint="Part de la hauteur du graphe réservée au volume — les bougies sont recalées automatiquement.">
                <Slider value={s.volumeHeight} min={0.08} max={0.4} step={0.01} onChange={v => set({ volumeHeight: v })} format={pct} />
              </Field>

              <Field label="Filigrane" inline>
                <Toggle on={s.watermark} onChange={v => set({ watermark: v })} labels={['Visible', 'Masqué']} />
              </Field>

              <Field label="Taille du filigrane" hint="Le symbole et l'unité de temps, en fond de graphe — utile sur les captures.">
                <Slider value={s.watermarkSize} min={20} max={90} onChange={v => set({ watermarkSize: v })} format={v => `${v} px`} />
              </Field>
            </>
          )}

          {/* ── DONNÉES ────────────────────────────────────────────── */}
          {tab === 'data' && (
            <>
              <Field label="Bougies au démarrage" hint="Nombre de bougies chargées à l'ouverture d'un graphique.">
                <input
                  type="number"
                  className={styles.numberInput}
                  min={BARS_MIN} max={BARS_MAX} step={100}
                  value={s.initialBars}
                  onChange={e => set({ initialBars: parseBarsInput(e.target.value, s.initialBars) })}
                  onBlur={e => set({ initialBars: clampBars(e.target.value, s.initialBars) })}
                />
              </Field>

              <Field label="Bougies par scroll" hint="Nombre de bougies ajoutées à chaque scroll vers l'historique.">
                <input
                  type="number"
                  className={styles.numberInput}
                  min={BARS_MIN} max={BARS_MAX} step={100}
                  value={s.barsPerScroll}
                  onChange={e => set({ barsPerScroll: parseBarsInput(e.target.value, s.barsPerScroll) })}
                  onBlur={e => set({ barsPerScroll: clampBars(e.target.value, s.barsPerScroll) })}
                />
              </Field>

              <Field
                label="Ratio d'imbalance (footprint)"
                hint={`Un côté doit être ${s.fpImbalanceRatio}× l'autre pour marquer un déséquilibre.`}
              >
                <Segmented
                  value={s.fpImbalanceRatio}
                  onChange={v => set({ fpImbalanceRatio: v })}
                  options={[2, 3, 4, 5].map(r => ({ v: r, l: `${r}:1` }))}
                />
              </Field>
            </>
          )}
        </div>

        <footer className={styles.foot}>
          <button className={styles.resetBtn} onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
            Réinitialiser
          </button>
          <button className={styles.doneBtn} onClick={onClose}>Terminé</button>
        </footer>
      </div>
    </div>
  );
}
