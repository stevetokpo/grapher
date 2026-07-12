import { useState, useEffect } from 'react';
import { TF_SECONDS } from '../../lib/replayUtils';
import styles from './BacktestConfig.module.css';

const TF_IDS = Object.keys(TF_SECONDS);

function toDateInput(tsStr) {
  if (!tsStr) return '';
  return String(tsStr).slice(0, 10);
}

function NumInput({ value, min, max, step = 1, onChange }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);

  const commit = raw => {
    const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
    const c = isNaN(n) ? (min ?? 0) : Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
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
        if (!isNaN(n)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)));
      }}
      onBlur={e => commit(e.target.value)}
    />
  );
}

// Rend un champ du schéma de paramètres d'une stratégie
function ParamField({ schema, value, onChange }) {
  switch (schema.type) {
    case 'select':
      return (
        <select className={styles.select} value={value} onChange={e => onChange(e.target.value)}>
          {schema.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'bool':
      return (
        <button
          className={`${styles.toggleBtn}${value ? ` ${styles.toggleBtnOn}` : ''}`}
          onClick={() => onChange(!value)}
        >
          {value ? 'Activé' : 'Désactivé'}
        </button>
      );
    default: // int | float
      return (
        <NumInput
          value={value}
          min={schema.min} max={schema.max}
          step={schema.step ?? (schema.type === 'float' ? 0.1 : 1)}
          onChange={onChange}
        />
      );
  }
}

export default function BacktestConfig({
  symbols, strategies,
  config, onConfigChange,
  onRun, running,
}) {
  const set = patch => onConfigChange({ ...config, ...patch });

  const currentSym  = symbols.find(s => s.id === config.symbolId) ?? null;
  const strategy    = strategies.find(s => s.id === config.strategyId) ?? null;
  const params      = config.params?.[config.strategyId] ?? {};
  const minDate     = currentSym ? toDateInput(currentSym.ts_min) : '';
  const maxDate     = currentSym ? toDateInput(currentSym.ts_max) : '';

  const setParam = (key, value) =>
    set({ params: { ...config.params, [config.strategyId]: { ...params, [key]: value } } });

  const resetParams = () => {
    if (!strategy) return;
    const defs = {};
    for (const p of strategy.params) defs[p.key] = p.def;
    set({ params: { ...config.params, [config.strategyId]: defs } });
  };

  const canRun = Boolean(
    config.symbolId && strategy
    && config.dateFrom && config.dateTo && config.dateFrom <= config.dateTo
    && !running
  );

  return (
    <aside className={styles.sidebar}>
      {/* ── Données ─────────────────────────────────────────────── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Données</h3>

        <div className={styles.field}>
          <span className={styles.label}>Symbole</span>
          <select
            className={styles.select}
            value={config.symbolId ?? ''}
            onChange={e => set({ symbolId: Number(e.target.value) })}
          >
            {symbols.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {currentSym && (
            <span className={styles.hint}>{minDate} → {maxDate}</span>
          )}
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.label}>Début</span>
            <input
              type="date" className={styles.dateInput}
              value={config.dateFrom} min={minDate} max={config.dateTo || maxDate}
              onChange={e => set({ dateFrom: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Fin</span>
            <input
              type="date" className={styles.dateInput}
              value={config.dateTo} min={config.dateFrom || minDate} max={maxDate}
              onChange={e => set({ dateTo: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Timeframe de décision</span>
          <div className={styles.tfGrid}>
            {TF_IDS.map(tf => (
              <button
                key={tf}
                className={`${styles.tfBtn}${config.tf === tf ? ` ${styles.tfBtnActive}` : ''}`}
                onClick={() => set({ tf })}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stratégie ───────────────────────────────────────────── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Stratégie</h3>

        <div className={styles.field}>
          <select
            className={styles.select}
            value={config.strategyId ?? ''}
            onChange={e => set({ strategyId: e.target.value })}
          >
            {strategies.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {strategy && <p className={styles.desc}>{strategy.desc}</p>}
        </div>

        {strategy && (
          <>
            <div className={styles.paramsHeader}>
              <span className={styles.label}>Paramètres</span>
              <button className={styles.resetBtn} onClick={resetParams}>↺ défauts</button>
            </div>
            {strategy.params.map(p => (
              <div key={p.key} className={styles.field}>
                <span className={styles.paramLabel}>{p.label}</span>
                <ParamField
                  schema={p}
                  value={params[p.key] ?? p.def}
                  onChange={v => setParam(p.key, v)}
                />
                {p.hint && <span className={styles.hint}>{p.hint}</span>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Exécution ───────────────────────────────────────────── */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Exécution</h3>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <span className={styles.paramLabel}>Spread (points)</span>
            <NumInput
              value={config.execution.spreadPoints}
              min={0} max={100000} step={0.01}
              onChange={v => set({ execution: { ...config.execution, spreadPoints: v } })}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.paramLabel}>Sortie forcée (bougies, 0 = off)</span>
            <NumInput
              value={config.execution.maxBarsInTrade}
              min={0} max={10000} step={1}
              onChange={v => set({ execution: { ...config.execution, maxBarsInTrade: v } })}
            />
          </div>
        </div>
        <p className={styles.hint}>
          Le spread est déduit une fois par trade, en points de prix.
        </p>
      </div>

      <button className={styles.runBtn} disabled={!canRun} onClick={onRun}>
        {running ? 'Backtest en cours…' : '▶ Lancer le backtest'}
      </button>
    </aside>
  );
}
