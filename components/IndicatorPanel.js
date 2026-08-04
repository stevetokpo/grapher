import { useState, useEffect } from 'react';
import styles from './IndicatorPanel.module.css';
import { RANGE_DEFAULTS, rangeLabel } from '../lib/periodZones';

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
  { type: 'EQ',    label: 'EQ',    desc: 'Point d\'équilibre', color: '#A78BFA', pane: 'overlay'  },
  { type: 'TRENDER', label: 'TRENDER', desc: 'Harmonie multi-HTF', color: '#34D399', pane: 'overlay' },
  { type: 'RANGE', label: 'RANGE', desc: 'Zones par période', color: '#60A5FA', pane: 'overlay' },
];

// Unités de temps supérieures (notation MT5), pour les 3 HTF de biais.
const HTF_KEYS = [
  'M1','M2','M3','M4','M5','M6','M10','M12','M15','M20','M30',
  'H1','H2','H3','H4','H6','H8','H12','H16','D1','W1',
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
  // EQ
  lookback: 60, threshold: 70, valueArea: 70, confirmBars: 2,
  showScore: true, showProfile: true, showNaked: true, showBreak: true,
  // TRENDER — défauts identiques à pines/trender.pine
  useHtf1: true, htf1: 'H1',
  useHtf2: true, htf2: 'H4',
  useHtf3: true, htf3: 'H16',
  bbLen: 50, bbMult: 0.369,
  confFlt: 'toutes',
  bgTransp: 80, showBg: true, showMark: true, showConf: true, showSlLn: true,
  bullColor: '#26A69A', bearColor: '#EF5350', slColor: '#EF5350',
  showBbCur: true, bbCurLen: 50, bbCurMult: 0.369, bbCurColor: '#60A5FA',
  // RANGE — les défauts vivent avec le calcul (lib/periodZones.js), pas ici :
  // ajouter un réglage à l'indicateur ne demande alors qu'un champ de formulaire.
  ...RANGE_DEFAULTS,
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
  if (ind.type === 'EQ')    return `seuil ${ind.threshold ?? 70} · VA ${ind.valueArea ?? 70}%`;
  if (ind.type === 'TRENDER') {
    const htf = [
      ind.useHtf1 !== false && (ind.htf1 ?? 'H1'),
      ind.useHtf2 !== false && (ind.htf2 ?? 'H4'),
      ind.useHtf3 !== false && (ind.htf3 ?? 'H16'),
    ].filter(Boolean).join(' · ');
    return htf || 'aucun HTF';
  }
  if (ind.type === 'RANGE') {
    return [
      ind.basis === 'body' ? 'corps' : 'mèches',
      ind.extend === 'cover' && 'prolongée',
      ind.frameSkip !== false && 'esquive encadrée',
      ind.periodMode === 'plage' ? 'chaque jour' : (ind.resetDaily !== false ? `dès ${ind.anchorHour ?? 0} h` : 'continu'),
    ].filter(Boolean).join(' · ');
  }
  return SOURCES.find(s => s.value === ind.source)?.label ?? ind.source;
}

function indPeriodLabel(ind) {
  if (ind.type === 'SWING')   return `${ind.leftBars ?? 5}/${ind.rightBars ?? 5}`;
  if (ind.type === 'EQ')      return String(ind.lookback ?? 60);
  if (ind.type === 'TRENDER') return `BB ${ind.bbLen ?? 50}`;
  if (ind.type === 'RANGE')   return rangeLabel(ind);
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
    } else if (selected === 'EQ') {
      if ((form.lookback ?? 60) < 20 || (form.lookback ?? 60) > 500) return;
    } else if (selected === 'TRENDER') {
      // Sans aucun HTF actif il n'y a pas d'harmonie à mesurer.
      if (!form.useHtf1 && !form.useHtf2 && !form.useHtf3) return;
      if ((form.bbLen ?? 50) < 1) return;
    } else if (selected === 'RANGE') {
      if (form.periodMode === 'plage') {
        // Une plage de durée nulle ne marquerait jamais rien.
        const from = (form.fromHour ?? 0) * 60 + (form.fromMin ?? 0);
        const to   = (form.toHour   ?? 0) * 60 + (form.toMin   ?? 0);
        if (from === to) return;
      } else if ((form.markLen ?? 4) < 1) return;
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

            {/* EQ fields */}
            {selected === 'EQ' && (
              <>
                <p className={styles.hint}>
                  Reconstruit l’enchère des N dernières bougies, en extrait le prix sur lequel
                  acheteurs et vendeurs s’accordent, et note 0-100 si le marché y est réellement
                  en équilibre. Au-delà du seuil, la zone de balance est figée ; elle ne meurt
                  que lorsque le prix est accepté hors de la valeur.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Fenêtre (bougies)</span>
                    <NumInput value={form.lookback ?? 60} min={20} max={500} onChange={v => setF({ lookback: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Seuil d’équilibre</span>
                    <NumInput value={form.threshold ?? 70} min={40} max={95} onChange={v => setF({ threshold: v })} />
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Value area (%)</span>
                    <NumInput value={form.valueArea ?? 70} min={50} max={95} onChange={v => setF({ valueArea: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Confirmation cassure</span>
                    <NumInput value={form.confirmBars ?? 2} min={1} max={10} onChange={v => setF({ confirmBars: v })} />
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>Couleur</span>
                  <Swatches value={form.color} onChange={c => setF({ color: c })} />
                </div>

                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.color }}>Affichage</span>
                  <div className={styles.fieldRow}>
                    {[
                      ['showScore',   'Score (sous-graphe)'],
                      ['showProfile', 'Profil d’enchère'],
                    ].map(([key, label]) => (
                      <div className={styles.field} key={key}>
                        <span className={styles.label}>{label}</span>
                        <button
                          className={`${styles.toggleBtn}${form[key] !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                          onClick={() => setF({ [key]: form[key] === false })}
                        >
                          {form[key] !== false ? 'Activé' : 'Désactivé'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className={styles.fieldRow}>
                    {[
                      ['showBreak', 'Cassures'],
                      ['showNaked', 'Naked POC'],
                    ].map(([key, label]) => (
                      <div className={styles.field} key={key}>
                        <span className={styles.label}>{label}</span>
                        <button
                          className={`${styles.toggleBtn}${form[key] !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                          onClick={() => setF({ [key]: form[key] === false })}
                        >
                          {form[key] !== false ? 'Activé' : 'Désactivé'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* TRENDER fields */}
            {selected === 'TRENDER' && (
              <>
                <p className={styles.hint}>
                  Une Bollinger sur chacune des 3 unités de temps supérieures donne un biais.
                  Quand <strong>tous les HTF actifs sont alignés</strong>, la zone d’harmonie
                  s’ouvre. L’étiquette au début de zone nomme le HTF qui a basculé sur cette
                  bougie — c’est lui qui complète l’harmonie. Non-repaint : chaque bougie lit
                  la dernière bougie HTF <em>clôturée</em>.
                </p>

                {/* 3 HTF de biais */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.color }}>
                    Biais — unités de temps supérieures
                  </span>
                  {[1, 2, 3].map(k => (
                    <div className={styles.fieldRow} key={k}>
                      <div className={styles.field}>
                        <span className={styles.label}>HTF {k}</span>
                        <button
                          className={`${styles.toggleBtn}${form[`useHtf${k}`] !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                          onClick={() => setF({ [`useHtf${k}`]: form[`useHtf${k}`] === false })}
                        >
                          {form[`useHtf${k}`] !== false ? 'Actif' : 'Inactif'}
                        </button>
                      </div>
                      <div className={styles.field}>
                        <span className={styles.label}>Unité</span>
                        <select
                          className={styles.sourceSelect}
                          value={form[`htf${k}`] ?? ['H1', 'H4', 'H16'][k - 1]}
                          onChange={e => setF({ [`htf${k}`]: e.target.value })}
                          disabled={form[`useHtf${k}`] === false}
                        >
                          {HTF_KEYS.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Bollinger — période</span>
                    <NumInput value={form.bbLen ?? 50} min={1} max={500} onChange={v => setF({ bbLen: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Bollinger — écart-type</span>
                    <NumInput value={form.bbMult ?? 0.369} min={0.01} max={5} step={0.001} onChange={v => setF({ bbMult: v })} />
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>Filtre — zones confirmées par</span>
                  <select className={styles.sourceSelect} value={form.confFlt ?? 'toutes'}
                    onChange={e => setF({ confFlt: e.target.value })}>
                    {['toutes', 'HTF 1', 'HTF 2', 'HTF 3'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                {/* Affichage des zones */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.bullColor ?? '#26A69A' }}>
                    Zones d’harmonie
                  </span>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Couleur haussière</span>
                      <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Couleur baissière</span>
                      <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
                    </div>
                  </div>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Transparence du fond</span>
                      <NumInput value={form.bgTransp ?? 80} min={0} max={100} onChange={v => setF({ bgTransp: v })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Fond coloré</span>
                      <button
                        className={`${styles.toggleBtn}${form.showBg !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                        onClick={() => setF({ showBg: form.showBg === false })}
                      >{form.showBg !== false ? 'Activé' : 'Désactivé'}</button>
                    </div>
                  </div>
                  <div className={styles.fieldRow}>
                    {[
                      ['showMark', 'Marqueur de début'],
                      ['showConf', 'Étiquette du confirmateur'],
                    ].map(([key, label]) => (
                      <div className={styles.field} key={key}>
                        <span className={styles.label}>{label}</span>
                        <button
                          className={`${styles.toggleBtn}${form[key] !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                          onClick={() => setF({ [key]: form[key] === false })}
                        >{form[key] !== false ? 'Activé' : 'Désactivé'}</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bollinger du timeframe courant + trait ≈ SL */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.bbCurColor ?? '#60A5FA' }}>
                    Bollinger du timeframe courant
                  </span>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Afficher les bandes</span>
                      <button
                        className={`${styles.toggleBtn}${form.showBbCur !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                        onClick={() => setF({ showBbCur: form.showBbCur === false })}
                      >{form.showBbCur !== false ? 'Activé' : 'Désactivé'}</button>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Trait base BB (≈ SL)</span>
                      <button
                        className={`${styles.toggleBtn}${form.showSlLn !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                        onClick={() => setF({ showSlLn: form.showSlLn === false })}
                      >{form.showSlLn !== false ? 'Activé' : 'Désactivé'}</button>
                    </div>
                  </div>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Période</span>
                      <NumInput value={form.bbCurLen ?? 50} min={1} max={500} onChange={v => setF({ bbCurLen: v })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Écart-type</span>
                      <NumInput value={form.bbCurMult ?? 0.369} min={0.01} max={5} step={0.001} onChange={v => setF({ bbCurMult: v })} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Couleur des bandes</span>
                    <Swatches value={form.bbCurColor ?? '#60A5FA'} onChange={c => setF({ bbCurColor: c })} />
                  </div>
                </div>
              </>
            )}

            {/* RANGE fields */}
            {selected === 'RANGE' && (
              <>
                <p className={styles.hint}>
                  Marque, période par période, l’<strong>intervalle de prix</strong> parcouru :
                  une boîte du plus bas au plus haut de la fenêtre. En mode <em>cycle</em>, on
                  marque pendant une durée puis on <strong>esquive</strong> la suivante, en boucle
                  ; en mode <em>plage</em>, on ne marque qu’une tranche horaire par jour. Les
                  heures sont celles du graphe (UTC serveur), et la zone en cours reste en
                  pointillés tant que sa fenêtre n’est pas finie.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Découpage</span>
                  <div className={styles.segmented}>
                    {[['cycle', 'Cycle marquage / esquive'], ['plage', 'Plage horaire du jour']].map(([v, l]) => (
                      <button key={v}
                        className={`${styles.segBtn}${(form.periodMode ?? 'cycle') === v ? ` ${styles.segBtnActive}` : ''}`}
                        onClick={() => setF({ periodMode: v })}
                      >{l}</button>
                    ))}
                  </div>
                </div>

                {/* Cycle : on marque X, on esquive Y */}
                {(form.periodMode ?? 'cycle') === 'cycle' && (
                  <div className={styles.markerGroup}>
                    <span className={styles.markerGroupLabel} style={{ color: form.color }}>
                      Cycle
                    </span>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <span className={styles.label}>Marquage</span>
                        <NumInput value={form.markLen ?? 4} min={1} max={999} onChange={v => setF({ markLen: v })} />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.label}>Esquive</span>
                        <NumInput value={form.skipLen ?? 4} min={0} max={999} onChange={v => setF({ skipLen: v })} />
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <span className={styles.label}>Unité</span>
                        <select className={styles.sourceSelect} value={form.stepUnit ?? 'h'}
                          onChange={e => setF({ stepUnit: e.target.value })}>
                          <option value="h">heures</option>
                          <option value="m">minutes</option>
                        </select>
                      </div>
                      <div className={styles.field}>
                        <span className={styles.label}>Ancrage (heure)</span>
                        <NumInput value={form.anchorHour ?? 0} min={0} max={23} onChange={v => setF({ anchorHour: v })} />
                      </div>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Recaler le cycle chaque jour</span>
                      <button
                        className={`${styles.toggleBtn}${form.resetDaily !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                        onClick={() => setF({ resetDaily: form.resetDaily === false })}
                      >{form.resetDaily !== false ? 'Activé' : 'Désactivé'}</button>
                    </div>
                  </div>
                )}

                {/* Plage : une tranche horaire par jour */}
                {form.periodMode === 'plage' && (
                  <div className={styles.markerGroup}>
                    <span className={styles.markerGroupLabel} style={{ color: form.color }}>
                      Plage horaire — une par jour, minuit franchissable (22:00 → 03:00)
                    </span>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <span className={styles.label}>De — heure</span>
                        <NumInput value={form.fromHour ?? 18} min={0} max={23} onChange={v => setF({ fromHour: v })} />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.label}>De — minute</span>
                        <NumInput value={form.fromMin ?? 0} min={0} max={59} onChange={v => setF({ fromMin: v })} />
                      </div>
                    </div>
                    <div className={styles.fieldRow}>
                      <div className={styles.field}>
                        <span className={styles.label}>À — heure</span>
                        <NumInput value={form.toHour ?? 23} min={0} max={23} onChange={v => setF({ toHour: v })} />
                      </div>
                      <div className={styles.field}>
                        <span className={styles.label}>À — minute</span>
                        <NumInput value={form.toMin ?? 0} min={0} max={59} onChange={v => setF({ toMin: v })} />
                      </div>
                    </div>
                  </div>
                )}

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Intervalle mesuré sur</span>
                    <div className={styles.segmented}>
                      {[['wick', 'Mèches'], ['body', 'Corps']].map(([v, l]) => (
                        <button key={v}
                          className={`${styles.segBtn}${(form.basis ?? 'wick') === v ? ` ${styles.segBtnActive}` : ''}`}
                          onClick={() => setF({ basis: v })}
                        >{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Prolonger sur l’esquive</span>
                    <button
                      className={`${styles.toggleBtn}${form.extend === 'cover' ? ` ${styles.toggleBtnOn}` : ''}`}
                      onClick={() => setF({ extend: form.extend === 'cover' ? 'none' : 'cover' })}
                    >{form.extend === 'cover' ? 'Activé' : 'Désactivé'}</button>
                  </div>
                </div>

                {/* Le créneau esquivé, encadré à son tour — sa propre boîte, sa
                    propre couleur, et un interrupteur pour n'en rien voir. */}
                <div className={styles.markerGroup}>
                  <span className={styles.markerGroupLabel} style={{ color: form.skipColor ?? '#94A3B8' }}>
                    Créneau esquivé
                  </span>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Encadrer l’esquive</span>
                      <button
                        className={`${styles.toggleBtn}${form.frameSkip !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                        onClick={() => setF({ frameSkip: form.frameSkip === false })}
                      >{form.frameSkip !== false ? 'Activé' : 'Désactivé'}</button>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Couleur du cadre</span>
                      <Swatches
                        value={form.skipColor ?? '#94A3B8'}
                        onChange={c => setF({ skipColor: c })}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Ligne médiane</span>
                    <button
                      className={`${styles.toggleBtn}${form.showMid !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                      onClick={() => setF({ showMid: form.showMid === false })}
                    >{form.showMid !== false ? 'Activée' : 'Désactivée'}</button>
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Étiquette horaire</span>
                    <button
                      className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                      onClick={() => setF({ showLabel: form.showLabel === false })}
                    >{form.showLabel !== false ? 'Activée' : 'Désactivée'}</button>
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Remplissage (%)</span>
                    <NumInput value={form.zoneOpacity ?? 12} min={0} max={100} onChange={v => setF({ zoneOpacity: v })} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Zones affichées (max)</span>
                    <NumInput value={form.maxZones ?? 200} min={1} max={2000} onChange={v => setF({ maxZones: v })} />
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.label}>Couleur selon le sens de la fenêtre</span>
                  <button
                    className={`${styles.toggleBtn}${form.dirColor === true ? ` ${styles.toggleBtnOn}` : ''}`}
                    onClick={() => setF({ dirColor: form.dirColor !== true })}
                  >{form.dirColor === true ? 'Activée' : 'Désactivée'}</button>
                </div>

                {form.dirColor === true ? (
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <span className={styles.label}>Fenêtre haussière</span>
                      <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
                    </div>
                    <div className={styles.field}>
                      <span className={styles.label}>Fenêtre baissière</span>
                      <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
                    </div>
                  </div>
                ) : (
                  <div className={styles.field}>
                    <span className={styles.label}>Couleur</span>
                    <Swatches value={form.color} onChange={c => setF({ color: c })} />
                  </div>
                )}
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

                    {(ind.type === 'RSI' || (ind.type === 'EQ' && ind.showScore !== false)) && (
                      <span className={styles.paneBadge}>↓</span>
                    )}

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
