import { useState, useEffect } from 'react';
import styles from './IndicatorPanel.module.css';

export const MA_COLORS = [
  '#60A5FA', '#F59E0B', '#A78BFA', '#F472B6',
  '#34D399', '#FB923C', '#E879F9', '#94A3B8',
];

const SOURCES = [
  { value: 'close',  label: 'Close'    },
  { value: 'open',   label: 'Open'     },
  { value: 'high',   label: 'High'     },
  { value: 'low',    label: 'Low'      },
  { value: 'hl2',    label: 'HL / 2'   },
  { value: 'hlc3',   label: 'HLC / 3'  },
  { value: 'ohlc4',  label: 'OHLC / 4' },
];

const SHAPES = [
  { value: 'arrowDown', label: '▼' },
  { value: 'arrowUp',   label: '▲' },
  { value: 'circle',    label: '●' },
  { value: 'square',    label: '■' },
  { value: 'cross',     label: '✕' },
];

const INDICATOR_TYPES = [
  { type: 'SMA',   label: 'SMA',   desc: 'Moyenne simple',   color: '#94A3B8', pane: 'overlay'     },
  { type: 'EMA',   label: 'EMA',   desc: 'Moyenne exp.',     color: '#60A5FA', pane: 'overlay'     },
  { type: 'WMA',   label: 'WMA',   desc: 'Moy. pondérée',   color: '#A78BFA', pane: 'overlay'     },
  { type: 'BB',    label: 'BB',    desc: 'Bollinger',        color: '#F59E0B', pane: 'overlay'     },
  { type: 'SWING', label: 'SWING', desc: 'Swing H/L',       color: '#34D399', pane: 'overlay'     },
  { type: 'RSI',   label: 'RSI',   desc: 'Force relative',  color: '#F472B6', pane: 'sous-graphe' },
];

const DEFAULT_FORM = {
  type: null,
  period: 20, source: 'close', color: MA_COLORS[0],
  stdDev: 2, offset: 0,
  leftBars: 5, rightBars: 5,
  highColor: '#F59E0B', lowColor: '#60A5FA',
  shapeHigh: 'arrowDown', shapeLow: 'arrowUp',
  showLabel: true, markerSize: 1,
  overbought: 70, oversold: 30,
};

function NumInput({ value, min, max, step = 1, onChange }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);

  const commit = (raw) => {
    const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
    const clamped = isNaN(n) ? min : Math.max(min, Math.min(max, n));
    setStr(String(clamped));
    onChange(clamped);
  };

  return (
    <input
      type="number"
      className={styles.periodInput}
      value={str}
      min={min}
      max={max}
      step={step}
      onChange={e => {
        const raw = e.target.value;
        setStr(raw);
        if (raw === '' || raw === '-') return;
        const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
        if (!isNaN(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={e => commit(e.target.value)}
    />
  );
}

function nextColor(indicators) {
  const used = new Set(indicators.map(i => i.color));
  return MA_COLORS.find(c => !used.has(c)) ?? MA_COLORS[indicators.length % MA_COLORS.length];
}

function newId() {
  return `ind_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function indParams(ind) {
  if (ind.type === 'BB')    return `±${ind.stdDev ?? 2}σ · off ${ind.offset ?? 0}`;
  if (ind.type === 'SWING') return ind.showLabel !== false ? 'labels on' : 'labels off';
  if (ind.type === 'RSI')   return `${ind.overbought ?? 70} / ${ind.oversold ?? 30}`;
  return SOURCES.find(s => s.value === ind.source)?.label ?? ind.source;
}

function indPeriodLabel(ind) {
  if (ind.type === 'SWING') return `${ind.leftBars ?? 5}/${ind.rightBars ?? 5}`;
  return String(ind.period ?? '—');
}

// ── Component ────────────────────────────────────────────────────────────────
export default function IndicatorPanel({ indicators, onChange, onClose }) {
  const [selected,  setSelected]  = useState(null);
  const [form,      setForm]      = useState({ ...DEFAULT_FORM });
  const [editingId, setEditingId] = useState(null);
  const setF = (patch) => setForm(f => ({ ...f, ...patch }));

  // ── Selection / edit flow ─────────────────────────────────────────────────
  const handleSelect = (type) => {
    if (editingId) {
      setEditingId(null);
      if (selected === type) { setSelected(null); return; }
    } else if (selected === type) {
      setSelected(null); return;
    }
    setSelected(type);
    setForm({ ...DEFAULT_FORM, type, color: nextColor(indicators) });
  };

  const startEdit = (ind) => {
    setEditingId(ind.id);
    setSelected(ind.type);
    setForm({ ...DEFAULT_FORM, ...ind });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setSelected(null);
  };

  // ── Add / update ──────────────────────────────────────────────────────────
  const save = () => {
    if (!selected) return;
    if (selected === 'SWING') {
      if ((form.leftBars ?? 5) < 1 || (form.rightBars ?? 5) < 1) return;
    } else if (form.period < 2 || form.period > 500) return;

    if (editingId) {
      onChange(indicators.map(i => i.id === editingId ? { ...i, ...form } : i));
      cancelEdit();
    } else {
      const next = [...indicators, { id: newId(), ...form }];
      onChange(next);
      setForm(f => ({ ...f, color: nextColor(next) }));
    }
  };

  const remove = (id) => {
    if (editingId === id) cancelEdit();
    onChange(indicators.filter(i => i.id !== id));
  };

  // ── Color swatches ────────────────────────────────────────────────────────
  const Swatches = ({ value, onChange: onSwatchChange }) => (
    <div className={styles.colorRow}>
      {MA_COLORS.map(c => (
        <button
          key={c}
          className={`${styles.swatch}${value === c ? ` ${styles.swatchActive}` : ''}`}
          style={{ '--swatch-color': c }}
          onClick={() => onSwatchChange(c)}
          aria-pressed={value === c}
          aria-label={`Couleur ${c}`}
        />
      ))}
    </div>
  );

  // ── Shape segmented control ───────────────────────────────────────────────
  const ShapePicker = ({ value, onChange: onShapeChange }) => (
    <div className={styles.segmented}>
      {SHAPES.map(s => (
        <button key={s.value}
          className={`${styles.segBtn}${value === s.value ? ` ${styles.segBtnActive}` : ''}`}
          onClick={() => onShapeChange(s.value)}
          title={s.value}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const typeInfo = INDICATOR_TYPES.find(t => t.type === selected);

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ind-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="ind-title" className={styles.title}>Indicateurs</h2>

        {/* ── Type card grid ───────────────────────────────────────────── */}
        <div className={styles.typeGrid}>
          {INDICATOR_TYPES.map(({ type, label, desc, color, pane }) => (
            <button
              key={type}
              className={`${styles.typeCard}${selected === type ? ` ${styles.typeCardActive}` : ''}`}
              onClick={() => handleSelect(type)}
            >
              <span className={styles.typeCardName} style={{ color }}>{label}</span>
              <span className={styles.typeCardDesc}>{desc}</span>
              {pane === 'sous-graphe' && (
                <span className={styles.typeCardBadge}>sous-graphe</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Config form ──────────────────────────────────────────────── */}
        {selected && (
          <div className={`${styles.formSection}${editingId ? ` ${styles.formSectionEdit}` : ''}`}>
            <div className={styles.formSectionHeader}>
              {editingId && <span className={styles.editingTag}>édition</span>}
              <span className={styles.formSectionTitle} style={{ color: typeInfo?.color }}>
                {typeInfo?.label}
              </span>
              <span className={styles.formSectionDesc}>
                {editingId ? 'modifier les paramètres' : typeInfo?.desc}
              </span>
              <button
                className={styles.formCloseBtn}
                onClick={editingId ? cancelEdit : () => setSelected(null)}
                aria-label="Fermer"
              >×</button>
            </div>

            {/* MA fields */}
            {['SMA', 'EMA', 'WMA'].includes(selected) && (
              <>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période</span>
                    <NumInput value={form.period} min={2} max={500} onChange={v => setF({ period: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Appliqué à</span>
                    <select className={styles.sourceSelect} value={form.source}
                      onChange={e => setF({ source: e.target.value })}>
                      {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>Couleur</span>
                  <Swatches value={form.color} onChange={c => setF({ color: c })} />
                </div>
              </>
            )}

            {/* BB fields */}
            {selected === 'BB' && (
              <>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période</span>
                    <NumInput value={form.period} min={2} max={500} onChange={v => setF({ period: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Appliqué à</span>
                    <select className={styles.sourceSelect} value={form.source}
                      onChange={e => setF({ source: e.target.value })}>
                      {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Écart type (σ)</span>
                    <NumInput value={form.stdDev ?? 2} min={0.1} max={10} step={0.1} onChange={v => setF({ stdDev: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Décalage (barres)</span>
                    <NumInput value={form.offset ?? 0} min={-50} max={50} onChange={v => setF({ offset: v })} />
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>Couleur</span>
                  <Swatches value={form.color} onChange={c => setF({ color: c })} />
                </div>
              </>
            )}

            {/* SWING fields */}
            {selected === 'SWING' && (
              <>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Barres gauche</span>
                    <NumInput value={form.leftBars ?? 5} min={1} max={100} onChange={v => setF({ leftBars: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Barres droite</span>
                    <NumInput value={form.rightBars ?? 5} min={1} max={100} onChange={v => setF({ rightBars: v })} />
                  </div>
                </div>

                {/* Swing High */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.highColor ?? '#F59E0B' }}>
                    Swing High
                  </span>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Couleur</span>
                      <Swatches value={form.highColor ?? '#F59E0B'} onChange={c => setF({ highColor: c })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Forme</span>
                      <ShapePicker
                        value={form.shapeHigh ?? 'arrowDown'}
                        onChange={v => setF({ shapeHigh: v })}
                      />
                    </div>
                  </div>
                </div>

                {/* Swing Low */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.lowColor ?? '#60A5FA' }}>
                    Swing Low
                  </span>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Couleur</span>
                      <Swatches value={form.lowColor ?? '#60A5FA'} onChange={c => setF({ lowColor: c })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Forme</span>
                      <ShapePicker
                        value={form.shapeLow ?? 'arrowUp'}
                        onChange={v => setF({ shapeLow: v })}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Taille marqueur</span>
                    <div className={styles.segmented}>
                      {[1, 2, 3].map(s => (
                        <button key={s}
                          className={`${styles.segBtn}${(form.markerSize ?? 1) === s ? ` ${styles.segBtnActive}` : ''}`}
                          onClick={() => setF({ markerSize: s })}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Labels SH/SL</span>
                    <button
                      className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                      onClick={() => setF({ showLabel: form.showLabel === false })}>
                      {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* RSI fields */}
            {selected === 'RSI' && (
              <>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période</span>
                    <NumInput value={form.period} min={2} max={500} onChange={v => setF({ period: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Appliqué à</span>
                    <select className={styles.sourceSelect} value={form.source}
                      onChange={e => setF({ source: e.target.value })}>
                      {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label} style={{ color: '#EF5350' }}>Surachat</span>
                    <NumInput value={form.overbought ?? 70} min={50} max={99} onChange={v => setF({ overbought: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label} style={{ color: '#26A69A' }}>Survente</span>
                    <NumInput value={form.oversold ?? 30} min={1} max={49} onChange={v => setF({ oversold: v })} />
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>Couleur</span>
                  <Swatches value={form.color} onChange={c => setF({ color: c })} />
                </div>
              </>
            )}

            <button
              className={`${styles.addBtn}${editingId ? ` ${styles.saveBtn}` : ''}`}
              onClick={save}
            >
              {editingId ? '✓ Enregistrer' : `+ Ajouter ${typeInfo?.label}`}
            </button>
          </div>
        )}

        {/* ── Active indicators ─────────────────────────────────────────── */}
        <div className={styles.activeSection}>
          <p className={styles.activeTitle}>
            Actifs
            {indicators.length > 0 && (
              <span className={styles.activeBadge}>{indicators.length}</span>
            )}
          </p>

          {indicators.length === 0 ? (
            <div className={styles.empty}>Aucun indicateur actif.</div>
          ) : (
            <ul className={styles.list}>
              {indicators.map(ind => {
                const meta = INDICATOR_TYPES.find(t => t.type === ind.type);
                const isEditing = editingId === ind.id;
                return (
                  <li
                    key={ind.id}
                    className={`${styles.indRow}${isEditing ? ` ${styles.indRowEditing}` : ''}`}
                  >
                    {ind.type === 'SWING' ? (
                      <span className={styles.twoDots}>
                        <span className={styles.colorDot} style={{ background: ind.highColor ?? '#F59E0B' }} />
                        <span className={styles.colorDot} style={{ background: ind.lowColor  ?? '#60A5FA' }} />
                      </span>
                    ) : (
                      <span className={styles.colorDot} style={{ background: ind.color }} />
                    )}

                    <span
                      className={styles.indTypeBadge}
                      style={{ color: meta?.color ?? 'var(--text-muted)', borderColor: (meta?.color ?? '#fff') + '30' }}
                    >
                      {ind.type}
                    </span>

                    <span className={styles.indPeriod}>{indPeriodLabel(ind)}</span>
                    <span className={styles.indSource}>{indParams(ind)}</span>

                    {ind.type === 'RSI' && <span className={styles.paneBadge}>↓</span>}

                    <button
                      className={`${styles.editBtn}${isEditing ? ` ${styles.editBtnActive}` : ''}`}
                      onClick={() => isEditing ? cancelEdit() : startEdit(ind)}
                      aria-label={`Modifier ${ind.type}`}
                    >✎</button>

                    <button
                      className={styles.removeBtn}
                      onClick={() => remove(ind.id)}
                      aria-label={`Supprimer ${ind.type}`}
                    >×</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
