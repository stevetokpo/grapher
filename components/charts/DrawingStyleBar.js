import styles from './DrawingStyleBar.module.css';

// ── Icons ─────────────────────────────────────────────────────────────────

const TrashIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);

const SolidLine = () => (
  <svg width="20" height="8" viewBox="0 0 20 8">
    <line x1="0" y1="4" x2="20" y2="4" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);
const DashedLine = () => (
  <svg width="20" height="8" viewBox="0 0 20 8">
    <line x1="0" y1="4" x2="20" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3"/>
  </svg>
);
const DottedLine = () => (
  <svg width="20" height="8" viewBox="0 0 20 8">
    <line x1="0" y1="4" x2="20" y2="4" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 3" strokeLinecap="round"/>
  </svg>
);

// ── Constants ─────────────────────────────────────────────────────────────

const PRESETS = [
  '#2196F3', '#26A69A', '#EF5350', '#F59E0B',
  '#A78BFA', '#EC4899', '#FFFFFF', '#64748B',
];

const WIDTHS = [
  { value: 1, label: '1px' },
  { value: 2, label: '2px' },
  { value: 3, label: '3px' },
];

const LINE_STYLES = [
  { id: 'solid',  icon: <SolidLine />,  title: 'Continu'   },
  { id: 'dashed', icon: <DashedLine />, title: 'Tirets'    },
  { id: 'dotted', icon: <DottedLine />, title: 'Pointillés'},
];

// ── Component ─────────────────────────────────────────────────────────────

export default function DrawingStyleBar({ drawing, onUpdate, onRemove }) {
  if (!drawing) return null;

  const style     = drawing.style ?? {};
  const color     = style.color     ?? '#2196F3';
  const lineWidth = style.lineWidth ?? 1;
  const lineStyle = style.lineStyle ?? 'solid';

  const update = (patch) => {
    onUpdate(drawing.id, { style: { ...style, ...patch } });
  };

  return (
    <div className={styles.bar}>
      {/* ── Color presets ─────────────────────────────────────────── */}
      <div className={styles.row}>
        {PRESETS.map(c => (
          <button
            key={c}
            className={`${styles.swatch} ${color === c ? styles.swatchOn : ''}`}
            style={{ backgroundColor: c }}
            onClick={() => update({ color: c })}
            title={c}
          />
        ))}
        {/* Custom color picker disguised as a rainbow swatch */}
        <label className={styles.colorPickerWrap} title="Couleur personnalisée">
          <input
            type="color"
            value={color}
            onChange={e => update({ color: e.target.value })}
            className={styles.colorPickerInput}
          />
        </label>
      </div>

      <div className={styles.sep} />

      {/* ── Line width ────────────────────────────────────────────── */}
      <div className={styles.row}>
        {WIDTHS.map(({ value, label }) => (
          <button
            key={value}
            className={`${styles.wBtn} ${lineWidth === value ? styles.on : ''}`}
            onClick={() => update({ lineWidth: value })}
            title={label}
          >
            <div className={styles.wLine} style={{ height: value + 0.5 }} />
          </button>
        ))}
      </div>

      <div className={styles.sep} />

      {/* ── Line style ────────────────────────────────────────────── */}
      <div className={styles.row}>
        {LINE_STYLES.map(ls => (
          <button
            key={ls.id}
            className={`${styles.lsBtn} ${lineStyle === ls.id ? styles.on : ''}`}
            onClick={() => update({ lineStyle: ls.id })}
            title={ls.title}
          >
            {ls.icon}
          </button>
        ))}
      </div>

      <div className={styles.sep} />

      {/* ── Delete ────────────────────────────────────────────────── */}
      <button
        className={styles.delBtn}
        onClick={() => onRemove(drawing.id)}
        title="Supprimer (Del)"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
