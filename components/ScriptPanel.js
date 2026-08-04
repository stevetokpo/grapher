// Panneau des SCRIPTS — le tiroir latéral, à côté des Indicateurs et des Patterns.
//
// Ce qu'un script a de plus qu'un pattern : un CAPITAL. On lui donne un compte,
// une bougie de départ prise parmi celles chargées sur le graphe, ses propres
// réglages, et il rend un relevé de compte — profits, appels de marge, stop outs.
//
// Le tiroir ne recouvre pas le graphe et ne bloque rien derrière lui : on règle
// en voyant les bougies. Replié, il ne reste qu'un rail sur le bord droit.
//
// Ajouter un script ne touche PAS ce fichier : le formulaire se dessine depuis
// son `fields` (cf. lib/scripts/registry.js).

import { useState, useMemo, useEffect, useCallback } from 'react';
import styles from './ScriptPanel.module.css';
import { SCRIPTS, getScript, defaultParams, sanitizeParams } from '../lib/scripts/registry';
import { ACCOUNT_DEFAULTS, ACCOUNT_FIELDS, sanitizeAccount } from '../lib/scripts/account';
import { runScript } from '../lib/scripts/engine';
import { summarizeRun, buildScriptReport } from '../lib/scripts/report';
import { toChartTrades } from '../lib/scripts/chartTrades';
import ScriptResults from './scripts/ScriptResults';

export const DEFAULT_SCRIPT_CONFIG = {
  scriptId:  SCRIPTS[0]?.id ?? null,
  account:   { ...ACCOUNT_DEFAULTS },
  params:    {},     // par scriptId — chaque script garde ses réglages
  startTime: null,   // null = première bougie chargée
};

// Heures MT5 : les timestamps sont naïfs (heure serveur du broker). On lit et on
// affiche en UTC partout, comme fmtTimeHM — sinon les heures divergent d'une vue
// à l'autre selon le fuseau de la machine.
const utcDay = t => new Date(t * 1000).toISOString().slice(0, 10);
const utcHm  = t => new Date(t * 1000).toISOString().slice(11, 16);

// ── Champs (même grammaire que lib/xfvg/params.js) ───────────────────────────
function NumInput({ value, min, max, step = 1, onChange }) {
  const [str, setStr] = useState(String(value ?? ''));
  useEffect(() => { setStr(String(value ?? '')); }, [value]);

  const commit = (raw) => {
    const n = parseFloat(raw);
    const clamped = isNaN(n) ? min : Math.max(min, Math.min(max, n));
    setStr(String(clamped));
    onChange(clamped);
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
        const n = parseFloat(raw);
        if (!isNaN(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={e => commit(e.target.value)}
    />
  );
}

function SchemaField({ field, form, defaults, setF }) {
  const { kind, key, label } = field;
  const effective = { ...defaults, ...form };
  if (field.when && !field.when(effective)) return null;

  if (kind === 'divider') return <div className={styles.divider}>{label}</div>;
  if (kind === 'hint')    return <p className={styles.hint}>{field.text}</p>;
  if (kind === 'row') {
    return (
      <div className={styles.fieldRow}>
        {field.fields.map(f => (
          <SchemaField key={f.key} field={f} form={form} defaults={defaults} setF={setF} />
        ))}
      </div>
    );
  }

  const value = form[key] ?? defaults[key];

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>

      {kind === 'number' && (
        <NumInput
          value={value}
          min={field.min} max={field.max} step={field.step ?? 1}
          onChange={v => setF({ [key]: v })}
        />
      )}

      {kind === 'toggle' && (
        <button
          className={`${styles.toggleBtn}${value === true ? ` ${styles.toggleBtnOn}` : ''}`}
          onClick={() => setF({ [key]: value !== true })}
        >
          {value === true ? (field.on ?? 'Activé') : (field.off ?? 'Désactivé')}
        </button>
      )}

      {kind === 'segmented' && (
        <div className={styles.segmented}>
          {field.options.map(o => (
            <button
              key={o.value}
              className={`${styles.segBtn}${value === o.value ? ` ${styles.segBtnActive}` : ''}`}
              onClick={() => setF({ [key]: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaForm({ fields, form, defaults, setF }) {
  return fields.map((f, i) => (
    <SchemaField key={f.key ?? `${f.kind}-${i}`} field={f} form={form} defaults={defaults} setF={setF} />
  ));
}

function Section({ title, summary, open, onToggle, children }) {
  return (
    <section className={`${styles.section}${open ? ` ${styles.sectionOpen}` : ''}`}>
      <button className={styles.sectionHead} onClick={onToggle} aria-expanded={open}>
        <span className={styles.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {summary && <span className={styles.sectionSummary}>{summary}</span>}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </section>
  );
}

// ── Panneau ──────────────────────────────────────────────────────────────────
export default function ScriptPanel({
  candles = [], symbolName = '', tfId = '', patterns = [],
  config, onChange, onClose,
  // Les positions vont se peindre SUR le graphe, derrière ce tiroir : c'est la
  // page qui les tient, pour qu'elles survivent à la fermeture du panneau — on
  // le referme justement pour les regarder.
  onTradesChange, onSelectTrade, selectedTradeId = null,
}) {
  const cfg = { ...DEFAULT_SCRIPT_CONFIG, ...(config ?? {}) };

  // Ce que le graphe sait, remis tel quel aux scripts : un script qui joue un
  // motif lit SES réglages ici plutôt que de les redemander. La détection se
  // règle donc à un seul endroit, le panneau Patterns.
  const context = useMemo(
    () => ({ patterns, symbol: symbolName, tf: tfId }),
    [patterns, symbolName, tfId],
  );

  const [collapsed, setCollapsed] = useState(false);
  const [openSec,   setOpenSec]   = useState({ script: true, account: true, start: true, params: true });
  const [running,   setRunning]   = useState(false);
  const [error,     setError]     = useState(null);
  const [result,    setResult]    = useState(null);
  const [onChart,   setOnChart]   = useState(true);

  const script   = getScript(cfg.scriptId) ?? SCRIPTS[0] ?? null;
  const defaults = useMemo(() => (script ? defaultParams(script) : {}), [script]);
  const params   = (script && cfg.params?.[script.id]) ?? {};

  const patch     = p => onChange({ ...cfg, ...p });
  const setAcct   = p => patch({ account: { ...cfg.account, ...p } });
  const setParams = p => patch({ params: { ...cfg.params, [script.id]: { ...params, ...p } } });

  const toggleSec = k => setOpenSec(s => ({ ...s, [k]: !s[k] }));

  // ── Bougie de départ ──────────────────────────────────────────────────────
  // On garde un TIMESTAMP, pas un index : les bougies arrivent en continu (live)
  // et se complètent vers le passé (scroll), un index ne désignerait pas deux
  // fois la même bougie.
  const days = useMemo(() => {
    const seen = new Map();
    for (const c of candles) {
      const d = utcDay(c.time);
      if (!seen.has(d)) seen.set(d, c.time);
    }
    return [...seen.entries()].map(([day, firstTime]) => ({ day, firstTime }));
  }, [candles]);

  const startIndex = useMemo(() => {
    if (!candles.length) return 0;
    if (cfg.startTime == null) return 0;
    const i = candles.findIndex(c => c.time >= cfg.startTime);
    return i === -1 ? candles.length - 1 : i;
  }, [candles, cfg.startTime]);

  const startBar   = candles[startIndex] ?? null;
  const startDay   = startBar ? utcDay(startBar.time) : '';
  const dayBars    = useMemo(
    () => candles.filter(c => utcDay(c.time) === startDay),
    [candles, startDay],
  );
  const barsToPlay = candles.length ? candles.length - startIndex : 0;

  const setStartTime = t => { setResult(null); patch({ startTime: t }); };
  const pickLast = n => setStartTime(candles.length > n ? candles[candles.length - n].time : candles[0]?.time ?? null);

  // Ce que le script dit de son propre réglage — pour le ringble, les seuils de
  // détection qu'il va réellement jouer. Il les lit dans le contexte, donc c'est
  // le seul endroit où on peut les voir sans ouvrir l'autre panneau.
  const scriptSummary = useMemo(() => {
    if (!script?.summary) return null;
    try { return script.summary({ params: { ...defaults, ...params }, context }); }
    catch { return null; }
  }, [script, params, defaults, context]);

  // ── Lancement ─────────────────────────────────────────────────────────────
  const launch = useCallback(() => {
    if (!script || !candles.length) return;
    setRunning(true);
    setError(null);
    onTradesChange?.([]);       // le graphe se vide avant de se remplir
    // Laisse le navigateur peindre l'état « en cours » avant de bloquer le fil.
    setTimeout(() => {
      try {
        const p    = sanitizeParams(script, params);
        const acct = sanitizeAccount(cfg.account);
        const run  = runScript({ candles, script, params: p, account: acct, context, startIndex });
        // `note` fige ce que le script empruntait au graphe AU MOMENT du run :
        // le panneau Patterns peut changer ensuite, le rapport ne doit pas mentir.
        setResult({ run, summary: summarizeRun(run), script, params: p, account: acct, note: scriptSummary });
        setOpenSec(s => ({ ...s, script: false, account: false, start: false, params: false }));
        setOnChart(true);
        onTradesChange?.(toChartTrades(run.trades, { pointValue: acct.pointValue }));
      } catch (e) {
        console.error('[script]', e);
        setError(e?.message ?? String(e));
        setResult(null);
        onTradesChange?.([]);
      } finally {
        setRunning(false);
      }
    }, 20);
  }, [script, candles, params, cfg.account, context, startIndex, scriptSummary, onTradesChange]);

  // Montrer / cacher les positions sur le graphe. Le tiroir recouvre une bande
  // du graphe : pouvoir les retirer sans relancer le script est le minimum.
  const toggleOnChart = useCallback(() => {
    if (!result) return;
    setOnChart(v => {
      const next = !v;
      onTradesChange?.(next
        ? toChartTrades(result.run.trades, { pointValue: result.account.pointValue })
        : []);
      return next;
    });
  }, [result, onTradesChange]);

  const download = useCallback(() => {
    if (!result) return;
    const doc = buildScriptReport({
      script:        result.script,
      params:        result.params,
      accountConfig: result.account,
      run:           result.run,
      symbol:        symbolName,
      tf:            tfId,
      notes:         result.note,
    });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `script-${result.script.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, symbolName, tfId]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Rail replié ───────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className={styles.rail} aria-label="Scripts (replié)">
        <button className={styles.railBtn} onClick={() => setCollapsed(false)} title="Déplier les scripts">
          <span className={styles.railText}>SCRIPTS</span>
        </button>
        {result && (
          <span
            className={`${styles.railPnl}${result.summary.netProfit >= 0 ? ` ${styles.pos}` : ` ${styles.neg}`}`}
            title="Profit net du dernier run"
          >
            {result.summary.netProfit >= 0 ? '+' : '−'}
            {Math.abs(result.summary.netProfit).toFixed(0)}
          </span>
        )}
        <button className={styles.railClose} onClick={onClose} title="Fermer">×</button>
      </aside>
    );
  }

  return (
    <aside className={styles.drawer} aria-label="Scripts">
      <header className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="8,6 3,12 8,18" />
            <polyline points="16,6 21,12 16,18" />
          </svg>
        </span>
        <span className={styles.headTitle}>SCRIPTS</span>
        <span className={styles.headSub}>{symbolName}{tfId ? ` · ${tfId.toUpperCase()}` : ''}</span>
        <div className={styles.spacer} />
        <button className={styles.iconBtn} onClick={() => setCollapsed(true)} title="Replier">⟩</button>
        <button className={styles.iconBtn} onClick={onClose} title="Fermer">×</button>
      </header>

      <div className={styles.body}>
        {/* ── Le script ───────────────────────────────────────────────── */}
        <Section
          title="Script" summary={script?.label ?? 'aucun'}
          open={openSec.script} onToggle={() => toggleSec('script')}
        >
          {SCRIPTS.length === 0 ? (
            <p className={styles.hint}>Aucun script pour l&apos;instant. Ils vivent dans lib/scripts/library/.</p>
          ) : SCRIPTS.map(s => (
            <button
              key={s.id}
              className={`${styles.scriptCard}${s.id === script?.id ? ` ${styles.scriptCardActive}` : ''}`}
              onClick={() => { setResult(null); patch({ scriptId: s.id }); }}
            >
              <span className={styles.scriptDot} style={{ background: s.color ?? '#60A5FA' }} />
              <span className={styles.scriptName}>{s.label}</span>
              <span className={styles.scriptDesc}>{s.desc}</span>
            </button>
          ))}
          {scriptSummary && (
            <p className={styles.linked}>
              <span className={styles.linkedLabel}>Détection du graphe</span>
              {scriptSummary}
            </p>
          )}
        </Section>

        {/* ── Le compte ───────────────────────────────────────────────── */}
        <Section
          title="Compte"
          summary={`$${Number(cfg.account?.capital ?? 0).toLocaleString('en-US')}`}
          open={openSec.account} onToggle={() => toggleSec('account')}
        >
          <SchemaForm fields={ACCOUNT_FIELDS} form={cfg.account ?? {}} defaults={ACCOUNT_DEFAULTS} setF={setAcct} />
        </Section>

        {/* ── Le départ ───────────────────────────────────────────────── */}
        <Section
          title="Début"
          summary={startBar ? `${startDay} ${utcHm(startBar.time)}` : '—'}
          open={openSec.start} onToggle={() => toggleSec('start')}
        >
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <span className={styles.label}>Date</span>
              <select
                className={styles.select}
                value={startDay}
                onChange={e => setStartTime(days.find(d => d.day === e.target.value)?.firstTime ?? null)}
              >
                {days.map(d => <option key={d.day} value={d.day}>{d.day}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Heure (UTC)</span>
              <select
                className={styles.select}
                value={startBar?.time ?? ''}
                onChange={e => setStartTime(Number(e.target.value))}
              >
                {dayBars.map(c => <option key={c.time} value={c.time}>{utcHm(c.time)}</option>)}
              </select>
            </div>
          </div>

          <div className={styles.quickRow}>
            <button className={styles.quickBtn} onClick={() => setStartTime(null)}>Tout</button>
            <button className={styles.quickBtn} onClick={() => pickLast(1000)}>1000 dern.</button>
            <button className={styles.quickBtn} onClick={() => pickLast(500)}>500 dern.</button>
            <button className={styles.quickBtn} onClick={() => pickLast(200)}>200 dern.</button>
          </div>

          <p className={styles.hint}>
            {candles.length
              ? <>{barsToPlay.toLocaleString()} bougies jouées, de {startDay} {utcHm(startBar.time)} à{' '}
                  {utcDay(candles[candles.length - 1].time)} {utcHm(candles[candles.length - 1].time)}.
                  Seules les bougies CHARGÉES sur le graphe sont disponibles — remonte le graphe
                  pour en charger davantage.</>
              : 'Aucune bougie chargée.'}
          </p>
        </Section>

        {/* ── Les réglages du script ──────────────────────────────────── */}
        {script && (
          <Section
            title="Réglages" summary={script.label}
            open={openSec.params} onToggle={() => toggleSec('params')}
          >
            <SchemaForm fields={script.fields ?? []} form={params} defaults={defaults} setF={setParams} />
            <button
              className={styles.resetBtn}
              onClick={() => patch({ params: { ...cfg.params, [script.id]: {} } })}
            >
              Réinitialiser les réglages
            </button>
          </Section>
        )}

        {/* ── Lancement ───────────────────────────────────────────────── */}
        <button
          className={styles.runBtn}
          onClick={launch}
          disabled={running || !script || !candles.length}
        >
          {running ? 'Exécution…' : '▶  Lancer le script'}
        </button>

        {error && <p className={styles.error}>Erreur du script — {error}</p>}

        {result && (
          <ScriptResults
            summary={result.summary}
            run={result.run}
            onDownload={download}
            onChart={onChart}
            onToggleChart={toggleOnChart}
            onSelectTrade={onSelectTrade}
            selectedTradeId={selectedTradeId}
          />
        )}
      </div>
    </aside>
  );
}
