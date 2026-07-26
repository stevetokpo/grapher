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
    desc:      'Deux bougies opposées à corps plein, de taille similaire et large vs ATR',
    color:     '#A78BFA',
    direction: 'both',
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    showLabel: true,
    markerSize: 1,
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
    // Filtres portés de pines/trender.pine (désactivés par défaut)
    minPts:        0,
    atrPeriod:     14,
    atrMin:        0,
    atrMax:        0,
  },
  {
    type:      'RFVG',
    label:     'rFVG / aFVG',
    desc:      'Gap laissé par une bougie large — à contre-courant de la MM50 (rFVG), ou partout (aFVG)',
    color:     '#FB923C',
    render:    'zone',
    mode:      'rfvg',
    direction: 'both',
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showLabel: true,
    minPts:       0,
    maPeriodFast: 15,
    maPeriodSlow: 200,
    atrPeriod: 14,
    atrMult:   1.5,
    atrMult3:  0,
    wick3:     false,
    sizeMode:  'range',
    extLen:    20,
    // Mode « position » : entrée marché à l'ouverture de B4, stop structurel
    // sous/sur l'extrême B3-B4 (marge en points), TP en points
    display:      'zone',
    slMarginPts:   2,
    tpPts:         10,
    beTriggerPts:  0,
    beTouchTrigger: 0,
    beBarsTrigger: 0,
    beLevelPts:    0,
    uniqueTrade:   false,
    skipAfterTp:   0,
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
  {
    type:      'HMBM',
    label:     'HM / BM',
    desc:      'Grosse bougie à contre-courant de la MM75 (≥ ATR) suivie d’une petite — entrée + SL',
    color:     '#22D3EE',
    render:    'zone',
    direction: 'both',
    maPeriod:  75,
    atrPeriod: 14,
    mult1:     1,
    mult2:     0.5,
    extLen:    5,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    slColor:   '#B22222',
    // Mode « position » : entrée marché à l'ouverture de X, SL = extrême M–X, TP en points
    display:   'levels',
    tpPts:     10,
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
                  min={0.1} max={5} step={0.1}
                  onChange={v => setF({ atrMult: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              Les deux corps TB doivent dépasser ATR(période) × multiplicateur. Plus bas = plus de
              signaux ; mettre la période à 0 désactive le filtre.
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

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Étirement max (barres, 0 = illimité)</span>
                <NumInput
                  value={form.maxLen ?? 0}
                  min={0} max={500} step={1}
                  onChange={v => setF({ maxLen: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Gap minimum (points, 0 = tous)</span>
                <NumInput
                  value={form.minPts ?? 0}
                  min={0} max={100000} step={0.1}
                  onChange={v => setF({ minPts: v })}
                />
              </div>
            </div>

            {/* Filtre ATR sur la bougie centrale — celle qui creuse le gap.
                Écarte à la fois les gaps laissés par une bougie insignifiante et
                ceux laissés par un pic. 0 = borne désactivée. */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>ATR — période</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Bougie centrale ≥ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMin ?? 0}
                  min={0} max={20} step={0.1}
                  onChange={v => setF({ atrMin: v })}
                />
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Bougie centrale ≤ ATR × (0 = off)</span>
              <NumInput
                value={form.atrMax ?? 0}
                min={0} max={20} step={0.1}
                onChange={v => setF({ atrMax: v })}
              />
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'RFVG' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>gap laissé par une bougie large</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <p className={styles.hint}>
              Motif de base : une bougie baissière (ou haussière) d'une taille ≥ x × ATR, laissant un
              gap entre la bougie précédente et la suivante.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Motifs retenus</span>
              <div className={styles.segmented}>
                {[
                  { value: 'rfvg',  label: 'Seuls les rFVG' },
                  { value: 'all',   label: 'Toutes (aFVG)' },
                  { value: 'super', label: 'superFVG' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.mode ?? 'rfvg') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ mode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              <b>rFVG</b> : la bougie doit en plus être entièrement du côté opposé à son sens par rapport
              à la MM (baissière au-dessus, haussière en dessous) — c'est le motif de retournement.
              <b> aFVG</b> : la MM n'est plus regardée, tout motif de base compte (les rFVG en font partie).
              Chaque zone est étiquetée selon ce qu'elle est vraiment.
              <b> superFVG</b> : sous-ensemble des rFVG dont la 3e bougie (celle qui referme le gap)
              clôture à contre-sens du motif — rFVG haussier + 3e bougie baissière, ou rFVG baissier
              + 3e bougie haussière.
            </p>

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

            <div className={styles.sectionDivider}>Bougie centrale</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>MM rapide — période</span>
                <NumInput
                  value={form.maPeriodFast ?? 15}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodFast: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>MM lente — période</span>
                <NumInput
                  value={form.maPeriodSlow ?? 200}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodSlow: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              La bougie doit être entièrement d'un côté des DEUX moyennes à la fois : son plus bas
              au-dessus de la MM rapide ET de la MM lente (baissier), son plus haut en dessous des
              deux (haussier). Elle ne touche jamais aucune des deux. En mode « Toutes », les MM ne
              filtrent plus rien mais servent encore à étiqueter les zones.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Mesure de la taille</span>
              <div className={styles.segmented}>
                {[
                  { value: 'range', label: 'Amplitude (H−B)' },
                  { value: 'body',  label: 'Corps (|C−O|)' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.sizeMode ?? 'range') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ sizeMode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Période ATR</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Taille ≥ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMult ?? 1.5}
                  min={0} max={20} step={0.1}
                  onChange={v => setF({ atrMult: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              L'ATR est lu sur la bougie qui précède, sinon il contiendrait déjà la bougie à qualifier.
              Plus haut = déplacements plus violents, moins de signaux.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Corps 3e bougie ≤ ATR × (0 = OFF)</span>
              <NumInput
                value={form.atrMult3 ?? 0}
                min={0} max={20} step={0.1}
                onChange={v => setF({ atrMult3: v })}
              />
            </div>
            <p className={styles.hint}>
              Impose une 3e bougie petite : son corps |clôture−ouverture| doit rester sous ce multiple
              de l'ATR, lu sur la centrale. Toujours le corps, même en mesure « Amplitude ».
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Mèche de rejet sur la 3e bougie</span>
              <button
                className={`${styles.toggleBtn}${form.wick3 === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ wick3: form.wick3 !== true })}
              >
                {form.wick3 === true ? 'Activée' : 'Désactivée'}
              </button>
            </div>
            <p className={styles.hint}>
              La mèche de la 3e bougie du côté d'où vient le motif doit dépasser son corps : mèche
              BASSE &gt; corps sur un rFVG haussier, mèche HAUTE &gt; corps sur un baissier. Avec le
              réglage ci-dessus, ça exige un marteau (haussier) ou une étoile filante (baissier).
            </p>

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.field}>
              <span className={styles.label}>Représentation</span>
              <div className={styles.segmented}>
                {[
                  { value: 'zone',     label: 'Zone' },
                  { value: 'position', label: 'Position' },
                  { value: 'both',     label: 'Les deux' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.display ?? 'zone') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ display: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.display ?? 'zone') !== 'zone' && (
              <>
                <p className={styles.hint}>
                  Entrée AU MARCHÉ à l'ouverture de B4, la bougie qui suit le motif (achat sur zone
                  haussière, vente sur baissière) : plus d'ordre en attente, la position est
                  toujours prise. Le stop n'est pas une distance — il est posé à la CLÔTURE de B4
                  sous l'extrême B3-B4 (haussier) ou dessus (baissier), marge comprise. Pendant
                  toute B4 la position est donc non protégée, seul le TP est actif ; le stop étant
                  construit sous l'extrême de B4, il ne peut pas y être touché. Ensuite elle court
                  jusqu'au TP ou au SL (les deux dans la même bougie : le SL gagne, pessimiste). Le
                  trait épais au milieu donne l'issue : <b>vert</b> TP, <b>rouge</b> SL.
                </p>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>SL — marge sous/sur l'extrême B3-B4 (points)</span>
                    <NumInput
                      value={form.slMarginPts ?? 2}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ slMarginPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>TP (points)</span>
                    <NumInput
                      value={form.tpPts ?? 10}
                      min={0.1} max={100000} step={0.1}
                      onChange={v => setF({ tpPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Le risque varie donc d'une position à l'autre : c'est la taille de B3-B4 qui le
                  fait, plus la marge. Le RR n'est plus un réglage — le moniteur et le rapport en
                  donnent la moyenne, et tout ce qui est en R est normalisé position par position.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Trade unique</span>
                  <button
                    className={`${styles.toggleBtn}${form.uniqueTrade === true ? ` ${styles.toggleBtnOn}` : ''}`}
                    onClick={() => setF({ uniqueTrade: form.uniqueTrade !== true })}
                  >
                    {form.uniqueTrade === true ? 'Activé' : 'Désactivé'}
                  </button>
                </div>
                <p className={styles.hint}>
                  Une seule position à la fois. Tant qu'elle n'est pas clôturée, tout nouveau motif
                  est ignoré — dans le sens de la position en cours comme à contre-sens : il ne
                  produit rien du tout. L'entrée se faisant à l'ouverture de B4, un motif dont B4
                  tombe sur la bougie de sortie de la position précédente est ignoré lui aussi :
                  à ce premier prix, la position vit encore.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Signaux à sauter après un TP (0 = off)</span>
                  <NumInput
                    value={form.skipAfterTp ?? 0}
                    min={0} max={500} step={1}
                    onChange={v => setF({ skipAfterTp: v })}
                  />
                </div>
                <p className={styles.hint}>
                  Après un gain (TP), on saute les N prochains signaux — le temps de se remettre en
                  condition. Chaque signal sauté est quand même simulé à blanc : s'il aurait AUSSI
                  gagné, le compteur repart à N (on continue de se reposer tant que le marché aurait
                  payé). Les trades sautés ne comptent pas dans le rapport, seulement dans le calcul
                  du compteur. Anti-lookahead : un signal n'est sauté que s'il entre après la sortie
                  du gain qui a armé le repos — garanti en <b>trade unique</b>, à activer de préférence
                  avec.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : seuil d'activation (points, 0 = off)</span>
                    <NumInput
                      value={form.beTriggerPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ beTriggerPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : niveau (points vs entrée)</span>
                    <NumInput
                      value={form.beLevelPts ?? 0}
                      min={-100000} max={100000} step={0.1}
                      onChange={v => setF({ beLevelPts: v })}
                    />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>BE sur retours à l'entrée (nb, 0 = off)</span>
                    <NumInput
                      value={form.beTouchTrigger ?? 0}
                      min={0} max={500} step={1}
                      onChange={v => setF({ beTouchTrigger: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE sur durée (bougies tenues, 0 = off)</span>
                    <NumInput
                      value={form.beBarsTrigger ?? 0}
                      min={0} max={5000} step={1}
                      onChange={v => setF({ beBarsTrigger: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Trois déclencheurs indépendants, aux effets différents.
                  {' '}<b>Profit</b> et <b>Durée</b> déplacent le <b>stop</b> à entrée ± niveau
                  (0 = entrée exacte, positif = gain verrouillé, négatif = perte réduite ; jamais
                  au-delà du stop structurel) — profit dès que le gain atteint le seuil (évalué dès
                  B4), durée dès que la position tient depuis N bougies. Sortie sur ce stop :
                  trait <b style={{ color: '#F59E0B' }}>ambre</b>.
                  {' '}<b>Retours</b> déplace le <b>TP</b> au miroir du SL (entrée ± risk0, même
                  distance que le stop côté profit = objectif 1R) dès que le prix est revenu N fois
                  sur l'entrée ; le stop structurel reste, la position vise ce gain de 1R au lieu
                  du TP d'origine. Attention : « même distance que le SL » n'est plus proche que si
                  le SL structurel est plus serré que le TP — sinon le TP réduit est plus loin.
                  Pessimiste : stop et TP testés avant l'armement (un TP l'emporte), un BE traversé
                  en gap rempli au pire de l'open.
                </p>
              </>
            )}

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Extension max (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={500} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Gap minimum (points, négatif OK)</span>
                <NumInput
                  value={form.minPts ?? 0}
                  min={-100000} max={100000} step={0.1}
                  onChange={v => setF({ minPts: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              La zone est tirée à droite sur ce nombre de barres puis coupée net.
              Le gap minimum est <b>signé</b> : 0 exige un vrai vide entre la 1re et
              la 3e bougie, une valeur <b>négative</b> accepte qu'elles se chevauchent
              jusqu'à cette profondeur — la zone est alors la bande commune aux deux
              bougies au lieu du vide.
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

        {editingType === 'HMBM' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>2 bougies — grosse contra-MM + petite</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <p className={styles.hint}>
              Bougie 1 : grosse bougie directionnelle entièrement du mauvais côté de la MM
              (<b>HM</b> haussière sous la MM, <b>BM</b> baissière au-dessus), corps ≥ mult1 × ATR.
              Bougie 2 (M) : petite, corps ≤ mult2 × ATR. La bougie suivante (X) porte le niveau
              d'entrée (son ouverture) ; le SL est l'extrême entre M et X.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HM' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BM' },
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
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HM (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BM (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Couleur du SL</span>
              <Swatches value={form.slColor ?? '#B22222'} onChange={c => setF({ slColor: c })} />
            </div>

            <div className={styles.sectionDivider}>Bougie 1 (contra-MM, grosse)</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>MM — période (SMA)</span>
                <NumInput
                  value={form.maPeriod ?? 75}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>ATR — période</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Bougie 1 — corps ≥ ATR ×</span>
                <NumInput
                  value={form.mult1 ?? 1}
                  min={0} max={10} step={0.1}
                  onChange={v => setF({ mult1: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Bougie 2 — corps ≤ ATR ×</span>
                <NumInput
                  value={form.mult2 ?? 0.5}
                  min={0} max={10} step={0.05}
                  onChange={v => setF({ mult2: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              L'ATR est lu sur la bougie qui précède la bougie 1, sinon il l'inclurait. Un seul ATR
              de référence sert aux deux tests (grosse bougie 1, petite bougie 2).
            </p>

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.field}>
              <span className={styles.label}>Représentation</span>
              <div className={styles.segmented}>
                {[
                  { value: 'levels',   label: 'Niveaux' },
                  { value: 'position', label: 'Position' },
                  { value: 'both',     label: 'Les deux' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.display ?? 'levels') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ display: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Longueur niveaux entrée / SL (barres)</span>
              <NumInput
                value={form.extLen ?? 5}
                min={1} max={200} step={1}
                onChange={v => setF({ extLen: v })}
              />
            </div>

            {(form.display ?? 'levels') !== 'levels' && (
              <>
                <div className={styles.sectionDivider}>Position simulée</div>
                <p className={styles.hint}>
                  Entrée au marché à l'ouverture de la bougie X (toujours prise). Le SL est
                  l'extrême entre M et X (déjà connu) ; le TP est posé à cette distance en points.
                  Pas de break-even. Suivi à partir de X+1, stop testé avant le TP (pessimiste).
                  Le trait du milieu donne l'issue : <b>vert</b> TP, <b>rouge</b> SL, <b>gris</b> encore ouverte.
                </p>
                <div className={styles.field}>
                  <span className={styles.label}>TP (points)</span>
                  <NumInput
                    value={form.tpPts ?? 10}
                    min={0.1} max={100000} step={0.1}
                    onChange={v => setF({ tpPts: v })}
                  />
                </div>
              </>
            )}

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
