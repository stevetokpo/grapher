import { useState, useEffect } from 'react';
import styles from './PatternPanel.module.css';

const COLORS = [
  '#26A69A', '#EF5350', '#60A5FA', '#F59E0B',
  '#A78BFA', '#F472B6', '#34D399', '#FB923C',
];

// Add an entry here each time a new pattern is implemented.
export const PATTERN_TYPES = [
  {
    type:      'TWINS_BARS',
    label:     'Twins Bars',
    desc:      'Corps plein, taille similaire (ratio configurable), précédées par bougies à mèches',
    color:     '#A78BFA',
    direction: 'both',
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    showLabel: true,
    markerSize: 1,
    lookback:        4,
    similarityRatio: 0.7,
    atrPeriod:       7,
    atrMult:         1.6,
  },
  {
    type:          'FVG',
    label:         'FVG / iFVG',
    desc:          "Fair Value Gap — zones d'imbalance (3 bougies)",
    color:         '#60A5FA',
    render:        'zone',
    direction:     'both',
    bullColor:     '#26A69A',
    bearColor:     '#EF5350',
    opacity:       0.18,
    showMitigated: true,
    showInverse:   true,
    showLabel:     true,
    maxLen:        0,
  },
  {
    type:      'HBH_BHB',
    label:     'HBH / BHB',
    desc:      '3 bougies : 1e & 3e englobent toute la 2e (mèches incl.)',
    color:     '#F59E0B',
    render:    'zone',
    direction: 'both',
    engMult:   1.5,
    extLen:    20,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showMid:   true,
    showLabel: true,
  },
  {
    type:      'HBHB_BHBH',
    label:     'HBHB / BHBH',
    desc:      '4 bougies groupées alternées : corps 1 & 3 ≥ bodyMult × corps 2, 4e clôture sous/sur ouverture 2e',
    color:     '#F472B6',
    render:    'zone',
    direction: 'both',
    bodyMult:  1.5,
    extLen:    20,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showLabel: true,
  },
  {
    type:          'COMPRESSION',
    label:         'Compression',
    desc:          'ATR plat puis expansion brusque (contraction de volatilité)',
    color:         '#34D399',
    render:        'zone',
    mode:          'atr',
    // méthode ATR plat
    atrPeriod:     14,
    flatTol:       0.12,
    breakMult:     1.8,
    // méthode squeeze TTM
    length:        20,
    bbMult:        2,
    kcMult:        1.5,
    // commun
    minLength:     6,
    extendToBreak: true,
    upColor:       '#26A69A',
    downColor:     '#EF5350',
    neutralColor:  '#64748B',
    opacity:       0.18,
    showArrow:     true,
    showLabel:     true,
  },
];

export const DEFAULT_PATTERNS = PATTERN_TYPES.map(p => ({ ...p, enabled: true }));

// ── Shared sub-components ─────────────────────────────────────────────────────

function NumInput({ value, min, max, step = 1, onChange }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);

  const commit = raw => {
    const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
    const c = isNaN(n) ? min : Math.max(min, Math.min(max, n));
    setStr(String(c));
    onChange(c);
  };

  return (
    <input
      type="number"
      className={styles.numInput}
      value={str}
      min={min} max={max} step={step}
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

function Swatches({ value, onChange: onCh }) {
  return (
    <div className={styles.colorRow}>
      {COLORS.map(c => (
        <button
          key={c}
          className={`${styles.swatch}${value === c ? ` ${styles.swatchActive}` : ''}`}
          style={{ '--sw': c }}
          onClick={() => onCh(c)}
          aria-pressed={value === c}
          aria-label={`Couleur ${c}`}
        />
      ))}
    </div>
  );
}

// ── PatternPanel ──────────────────────────────────────────────────────────────

export default function PatternPanel({ patterns, onChange, onClose }) {
  const [editingType, setEditingType] = useState(null);
  const [form, setForm]               = useState({});
  const setF = patch => setForm(f => ({ ...f, ...patch }));

  // Merge stored patterns with PATTERN_TYPES so new patterns always appear.
  const merged = PATTERN_TYPES.map(pt => {
    const stored = patterns.find(p => p.type === pt.type);
    return stored ? { ...pt, ...stored } : { ...pt, enabled: true };
  });

  const emit = updated => onChange(updated);

  const toggleEnabled = type =>
    emit(merged.map(p => p.type === type ? { ...p, enabled: !p.enabled } : p));

  const startEdit = pat => {
    if (editingType === pat.type) { setEditingType(null); return; }
    setEditingType(pat.type);
    setForm({ ...pat });
  };

  const save = () => {
    emit(merged.map(p => p.type === form.type ? { ...p, ...form } : p));
    setEditingType(null);
  };

  const editingMeta = PATTERN_TYPES.find(pt => pt.type === editingType);

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pat-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="pat-title" className={styles.title}>Patterns</h2>

        {/* ── Pattern list ───────────────────────────────────────────── */}
        <ul className={styles.list}>
          {merged.map(pat => {
            const isEditing = editingType === pat.type;
            return (
              <li
                key={pat.type}
                className={`${styles.patRow}${isEditing ? ` ${styles.patRowEditing}` : ''}`}
              >
                <span className={styles.dot} style={{ background: pat.color }} />
                <span className={styles.patLabel} style={{ color: pat.color }}>{pat.label}</span>
                <span className={styles.patDesc}>{pat.desc}</span>
                <button
                  className={`${styles.editBtn}${isEditing ? ` ${styles.editBtnActive}` : ''}`}
                  onClick={() => startEdit(pat)}
                  aria-label={`Configurer ${pat.label}`}
                >✎</button>
                <button
                  className={`${styles.toggle}${pat.enabled ? ` ${styles.toggleOn}` : ''}`}
                  onClick={() => toggleEnabled(pat.type)}
                  aria-pressed={pat.enabled}
                  aria-label={`${pat.enabled ? 'Désactiver' : 'Activer'} ${pat.label}`}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </li>
            );
          })}
        </ul>

        {/* ── Config form ────────────────────────────────────────────── */}
        {editingType === 'TWINS_BARS' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>règles de détection</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ Haussier' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ Baissier' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur haussière</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur baissière</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Taille marqueur</span>
                <div className={styles.segmented}>
                  {[1, 2, 3].map(s => (
                    <button
                      key={s}
                      className={`${styles.segBtn}${(form.markerSize ?? 1) === s ? ` ${styles.segBtnActive}` : ''}`}
                      onClick={() => setF({ markerSize: s })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <div className={styles.sectionDivider}>Ressemblance des corps</div>

            <div className={styles.field}>
              <span className={styles.label}>Ratio de similarité (corps min / corps max)</span>
              <NumInput
                value={form.similarityRatio ?? 0.7}
                min={0.1} max={1} step={0.05}
                onChange={v => setF({ similarityRatio: v })}
              />
            </div>
            <p className={styles.hint}>
              0.7 = le plus petit corps doit faire ≥ 70 % du plus grand. Plus élevé = jumeaux plus proches.
            </p>

            <div className={styles.sectionDivider}>Filtre compression</div>

            <div className={styles.field}>
              <span className={styles.label}>Bougies à mèches avant (0 = désactivé)</span>
              <NumInput
                value={form.lookback ?? 4}
                min={0} max={20} step={1}
                onChange={v => setF({ lookback: v })}
              />
            </div>
            <p className={styles.hint}>
              Chaque bougie doit être à mèches dominantes : corps &lt; mèche haute + mèche basse.
            </p>

            <div className={styles.sectionDivider}>Filtre taille ATR</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Période ATR (0 = désactivé)</span>
                <NumInput
                  value={form.atrPeriod ?? 7}
                  min={0} max={50} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Multiplicateur ATR</span>
                <NumInput
                  value={form.atrMult ?? 1.6}
                  min={1.6} max={5} step={0.1}
                  onChange={v => setF({ atrMult: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              Les deux corps TB doivent dépasser ATR(période) × multiplicateur.
            </p>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'FVG' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>zones d'imbalance</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ Haussier' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ Baissier' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur haussière</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur baissière</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Gaps comblés (grisés)</span>
                <button
                  className={`${styles.toggleBtn}${form.showMitigated !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showMitigated: form.showMitigated === false })}
                >
                  {form.showMitigated !== false ? 'Affichés' : 'Masqués'}
                </button>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>iFVG (inversion)</span>
                <button
                  className={`${styles.toggleBtn}${form.showInverse !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showInverse: form.showInverse === false })}
                >
                  {form.showInverse !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Étirement max (barres, 0 = illimité)</span>
              <NumInput
                value={form.maxLen ?? 0}
                min={0} max={500} step={1}
                onChange={v => setF({ maxLen: v })}
              />
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'HBH_BHB' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>3 bougies — englobante / milieu / clôture</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HBH' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BHB' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HBH (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BHB (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Multiple d'englobement min. (×2e)</span>
                <NumInput
                  value={form.engMult ?? 1.5}
                  min={1} max={5} step={0.1}
                  onChange={v => setF({ engMult: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Longueur zone (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={200} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Ligne médiane</span>
                <button
                  className={`${styles.toggleBtn}${form.showMid !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showMid: form.showMid === false })}
                >
                  {form.showMid !== false ? 'Affichée' : 'Masquée'}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Labels</span>
              <button
                className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ showLabel: form.showLabel === false })}
              >
                {form.showLabel !== false ? 'Activés' : 'Désactivés'}
              </button>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'HBHB_BHBH' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>4 bougies groupées alternées</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HBHB' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BHBH' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HBHB (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BHBH (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Multiple de corps min. (×2e bougie)</span>
                <NumInput
                  value={form.bodyMult ?? 1.5}
                  min={1} max={5} step={0.1}
                  onChange={v => setF({ bodyMult: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Longueur zone (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={200} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              Corps bougie 1 et 3 doivent être ≥ bodyMult × corps bougie 2. La zone couvre le haut/bas de la 2e bougie.
            </p>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'COMPRESSION' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>squeeze TTM — Bollinger / Keltner</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur cassure haussière</span>
              <Swatches value={form.upColor ?? '#26A69A'} onChange={c => setF({ upColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur cassure baissière</span>
              <Swatches value={form.downColor ?? '#EF5350'} onChange={c => setF({ downColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#64748B' }}>Couleur en formation</span>
              <Swatches value={form.neutralColor ?? '#64748B'} onChange={c => setF({ neutralColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Méthode</span>
              <div className={styles.segmented}>
                {[
                  { value: 'atr',     label: 'ATR plat' },
                  { value: 'squeeze', label: 'Squeeze BB/KC' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.mode ?? 'atr') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ mode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.mode ?? 'atr') === 'atr' ? (
              <>
                <div className={styles.sectionDivider}>Détection (ATR plat)</div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période ATR</span>
                    <NumInput
                      value={form.atrPeriod ?? 14}
                      min={2} max={100} step={1}
                      onChange={v => setF({ atrPeriod: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Longueur min. (barres)</span>
                    <NumInput
                      value={form.minLength ?? 6}
                      min={2} max={50} step={1}
                      onChange={v => setF({ minLength: v })}
                    />
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Tolérance « plat » (±)</span>
                    <NumInput
                      value={form.flatTol ?? 0.12}
                      min={0.02} max={0.5} step={0.01}
                      onChange={v => setF({ flatTol: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Saut de cassure (×ATR)</span>
                    <NumInput
                      value={form.breakMult ?? 1.8}
                      min={1.1} max={4} step={0.1}
                      onChange={v => setF({ breakMult: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  L'ATR doit rester dans ±tolérance autour de sa moyenne (volatilité figée), puis
                  bondir d'au moins ×saut = cassure brusque. Tolérance plus basse = compression plus stricte.
                </p>
              </>
            ) : (
              <>
                <div className={styles.sectionDivider}>Détection (squeeze)</div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période (BB/KC/ATR)</span>
                    <NumInput
                      value={form.length ?? 20}
                      min={5} max={100} step={1}
                      onChange={v => setF({ length: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Longueur min. (barres)</span>
                    <NumInput
                      value={form.minLength ?? 6}
                      min={2} max={50} step={1}
                      onChange={v => setF({ minLength: v })}
                    />
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Multiplicateur Bollinger (σ)</span>
                    <NumInput
                      value={form.bbMult ?? 2}
                      min={1} max={4} step={0.1}
                      onChange={v => setF({ bbMult: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Multiplicateur Keltner (ATR)</span>
                    <NumInput
                      value={form.kcMult ?? 1.5}
                      min={1} max={4} step={0.1}
                      onChange={v => setF({ kcMult: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Squeeze quand les Bollinger rentrent dans les Keltner. Multiplicateur Bollinger plus
                  bas ou Keltner plus haut = détection plus stricte.
                </p>
              </>
            )}

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Étirer jusqu'à la cassure</span>
                <button
                  className={`${styles.toggleBtn}${form.extendToBreak !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ extendToBreak: form.extendToBreak === false })}
                >
                  {form.extendToBreak !== false ? 'Oui' : 'Non'}
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Flèche de cassure</span>
                <button
                  className={`${styles.toggleBtn}${form.showArrow !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showArrow: form.showArrow === false })}
                >
                  {form.showArrow !== false ? 'Affichée' : 'Masquée'}
                </button>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <button className={styles.allBtn}  onClick={() => emit(merged.map(p => ({ ...p, enabled: true })))}>
            Tout activer
          </button>
          <button className={styles.noneBtn} onClick={() => emit(merged.map(p => ({ ...p, enabled: false })))}>
            Tout désactiver
          </button>
        </div>
      </div>
    </div>
  );
}
