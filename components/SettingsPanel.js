import styles from './SettingsPanel.module.css';

export const DEFAULT_SETTINGS = {
  bullColor:        '#26A69A',
  bearColor:        '#EF5350',
  showVolume:       true,
  fpImbalanceRatio: 3,
};

const CANDLE_COLORS = [
  '#26A69A', '#34D399', '#4ADE80', '#22C55E',
  '#EF5350', '#F87171', '#FB923C', '#F59E0B',
  '#60A5FA', '#A78BFA', '#F472B6', '#94A3B8',
];

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
  </div>
);

export default function SettingsPanel({ settings, onChange, onClose }) {
  const s   = { ...DEFAULT_SETTINGS, ...settings };
  const set = (patch) => onChange({ ...s, ...patch });

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="settings-title" className={styles.title}>Réglages</h2>

        {/* ── Bougies ──────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Bougies</h3>

          <div className={styles.field}>
            <span className={styles.label}>
              <span className={styles.labelDot} style={{ background: s.bullColor }} />
              Haussière
            </span>
            <Swatches value={s.bullColor} onChange={v => set({ bullColor: v })} />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>
              <span className={styles.labelDot} style={{ background: s.bearColor }} />
              Baissière
            </span>
            <Swatches value={s.bearColor} onChange={v => set({ bearColor: v })} />
          </div>

          <div className={styles.fieldRow}>
            <span className={styles.label}>Volume</span>
            <button
              className={`${styles.toggleBtn}${s.showVolume ? ` ${styles.toggleBtnOn}` : ''}`}
              onClick={() => set({ showVolume: !s.showVolume })}
            >
              {s.showVolume ? 'Visible' : 'Masqué'}
            </button>
          </div>

          {/* Preview */}
          <div className={styles.candlePreview}>
            <svg width="80" height="48" viewBox="0 0 80 48" aria-hidden="true">
              {/* Bear candle */}
              <line x1="20" y1="4"  x2="20" y2="44" stroke={s.bearColor} strokeWidth="1.5"/>
              <rect x="12" y="12" width="16" height="22" fill={s.bearColor} rx="1"/>
              {/* Bull candle */}
              <line x1="60" y1="6"  x2="60" y2="44" stroke={s.bullColor} strokeWidth="1.5"/>
              <rect x="52" y="18" width="16" height="20" fill={s.bullColor} rx="1"/>
            </svg>
          </div>
        </section>

        {/* ── Footprint ─────────────────────────────────────────────── */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Footprint</h3>

          <div className={styles.field}>
            <span className={styles.label}>Ratio d'imbalance</span>
            <div className={styles.segmented}>
              {[2, 3, 4, 5].map(r => (
                <button
                  key={r}
                  className={`${styles.segBtn}${s.fpImbalanceRatio === r ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => set({ fpImbalanceRatio: r })}
                >
                  {r}:1
                </button>
              ))}
            </div>
            <span className={styles.hint}>
              Un côté doit être {s.fpImbalanceRatio}× l'autre pour marquer un déséquilibre.
            </span>
          </div>
        </section>

        {/* ── Reset ─────────────────────────────────────────────────── */}
        <button
          className={styles.resetBtn}
          onClick={() => onChange({ ...DEFAULT_SETTINGS })}
        >
          Réinitialiser les réglages
        </button>
      </div>
    </div>
  );
}
