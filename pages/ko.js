// /ko — réglages KO par symbole : on calibre les SORTIES (marge du stop, TP,
// break-even) et, contrairement au rFVG, on a le droit de toucher à la DÉTECTION
// — mais jamais gratuitement.
//
// LA PAGE NE DÉCIDE RIEN — elle montre. Trois chiffres décident, dans cet ordre :
//   1. le BUDGET DE LIBERTÉ (sonde) — combien de paramètres l'échantillon peut
//      porter, à ~30 positions par paramètre réglé. Régler au-delà, c'est
//      mémoriser l'historique ;
//   2. la fenêtre OUT-OF-SAMPLE — celle qui n'a servi à régler aucun paramètre ;
//   3. le CONTRÔLE PAR DÉCALAGE CIRCULAIRE — les mêmes signaux joués à des dates
//      d'entrée décalées. Si le vrai réglage ne sort pas de ce nuage, il ne
//      mesure pas le motif : il mesure la géométrie d'un stop serré sur cet
//      instrument, que n'importe quelle date d'entrée aurait donnée.
// Le troisième n'est pas un luxe ici : la détection étant balayable, le nombre
// d'essais est grand, et avec assez d'essais on trouve toujours un beau réglage.
//
// Le découpage IS/OOS suit les données RÉELLES du symbole (elles n'ont ni la
// même profondeur ni la même fin d'un instrument à l'autre) : les `split` %
// premiers pour régler, la fin — la plus récente — pour juger.
//
// Le formulaire se génère depuis lib/ko/params.js, le même schéma qui valide côté
// API : impossible que la page propose un réglage que le simulateur refuserait,
// ou l'inverse.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/tuning.module.css';
import { DETECT_SCHEMA, EXIT_SCHEMA, defaultsOf } from '../lib/ko/params';

const BULL = '#26A69A', BEAR = '#EF5350', AMBER = '#F59E0B', MUTED = '#94A3B8';

const TFS = ['1m', '3m', '5m', '10m', '15m', '20m', '30m', '1h', '2h', '4h'];

// ~30 positions par paramètre réglé : le repère de la maison, le même que celui
// que /api/ko/optimize applique à ses grilles.
const POSITIONS_PER_PARAM = 30;

const STATUS = {
  draft:     { label: 'brouillon', color: MUTED,  hint: "réglé, pas encore jugé hors échantillon" },
  validated: { label: 'validé',    color: BULL,   hint: "a survécu à l'out-of-sample, au contrôle par décalage et au stress des coûts" },
  rejected:  { label: 'rejeté',    color: BEAR,   hint: 'piste morte — gardée pour ne pas la ré-explorer' },
};

const fmt  = (v, d = 2) => v == null || Number.isNaN(v) ? '—' : Number.isFinite(v) ? v.toFixed(d) : '∞';
const pct  = v => v == null ? '—' : `${(v * 100).toFixed(1)} %`;
const pts  = (v, d = 2) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)} pts`;
const day  = e => e == null ? '—' : new Date(e * 1000).toISOString().slice(0, 10);

/* ── Champ de formulaire, généré depuis le schéma ─────────────────────────── */

function Field({ spec, value, onChange, disabled }) {
  const id = `f-${spec.key}`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {spec.label} <span className={styles.labelKey}>{spec.key}</span>
      </label>
      {spec.type === 'bool' ? (
        <div className={styles.check}>
          <input id={id} type="checkbox" checked={!!value} disabled={disabled}
            onChange={e => onChange(e.target.checked)} />
          <span>{value ? 'actif' : 'inactif'}</span>
        </div>
      ) : spec.type === 'select' ? (
        <select id={id} className={styles.select} value={value ?? spec.def} disabled={disabled}
          onChange={e => onChange(e.target.value)}>
          {spec.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input id={id} type="number" className={styles.input} disabled={disabled}
          value={value ?? spec.def} min={spec.min} max={spec.max}
          step={spec.step ?? (spec.type === 'int' ? 1 : 'any')}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') return onChange('');
            const n = spec.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isFinite(n) ? n : '');
          }} />
      )}
      {spec.hint && <span className={styles.hint}>{spec.hint}</span>}
    </div>
  );
}

function Tile({ label, value, sub, color }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileKey}>{label}</span>
      <span className={styles.tileVal} style={color ? { color } : undefined}>{value}</span>
      {sub && <span className={styles.tileSub}>{sub}</span>}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function KoPage() {
  const [symbols, setSymbols] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [sel,     setSel]     = useState(null);   // { symbolId, tf, name } de la config ouverte

  const [form, setForm] = useState(() => ({
    symbolId: null, tf: '5m', name: 'base', status: 'draft', notes: '',
    detect: defaultsOf(DETECT_SCHEMA), exit: defaultsOf(EXIT_SCHEMA),
    fills: 'bar', spreadPoints: 0, split: 0.7, firstN: 0, nullWindow: 'full', draws: 60,
  }));

  const [runs,  setRuns]  = useState(null);   // { is, oos, full }
  const [probe, setProbe] = useState(null);
  const [nul,   setNul]   = useState(null);   // contrôle par décalage circulaire
  const [busy,  setBusy]  = useState(null);
  const [error, setError] = useState(null);

  const setF  = patch => setForm(f => ({ ...f, ...patch }));
  const setD  = (k, v) => setForm(f => ({ ...f, detect: { ...f.detect, [k]: v } }));
  const setE  = (k, v) => setForm(f => ({ ...f, exit:   { ...f.exit,   [k]: v } }));

  const reload = useCallback(async () => {
    const [s, c] = await Promise.all([
      fetch('/api/symbols').then(r => r.json()),
      fetch('/api/ko/configs').then(r => r.json()),
    ]);
    setSymbols(s); setConfigs(c);
    return c;
  }, []);

  useEffect(() => { reload().catch(e => setError(e.message)); }, [reload]);

  const symbol = useMemo(
    () => symbols.find(s => s.id === form.symbolId) ?? null, [symbols, form.symbolId]);

  // Fenêtres IS / OOS, calées sur les données réelles du symbole.
  const windows = useMemo(() => {
    if (!symbol) return null;
    const from = Math.floor(Date.parse(`${symbol.ts_min.slice(0, 10)}T00:00:00Z`) / 1000);
    const to   = Math.floor(Date.parse(`${symbol.ts_max.replace(' ', 'T')}Z`) / 1000);
    const cut  = Math.floor(from + (to - from) * form.split);
    return { is: { from, to: cut }, oos: { from: cut, to: null }, full: { from, to: null }, cut, from, to };
  }, [symbol, form.split]);

  const openConfig = c => {
    setSel({ symbolId: c.symbolId, tf: c.tf, name: c.name });
    setForm(f => ({
      ...f, symbolId: c.symbolId, tf: c.tf, name: c.name, status: c.status,
      notes: c.notes ?? '', detect: { ...defaultsOf(DETECT_SCHEMA), ...c.detect },
      exit: { ...defaultsOf(EXIT_SCHEMA), ...c.exit },
      fills: c.fills, spreadPoints: c.spreadPoints,
    }));
    setRuns(null); setProbe(null); setNul(null); setError(null);
  };

  // Ajouter un symbole à l'étude : on garde la DÉTECTION en cours (c'est le même
  // motif partout) et on repart des sorties par défaut, à calibrer.
  const addSymbol = id => {
    setSel(null);
    setForm(f => ({ ...f, symbolId: Number(id), name: 'base', status: 'draft', notes: '' }));
    setRuns(null); setProbe(null); setNul(null); setError(null);
  };

  const body = extra => ({
    symbolId: form.symbolId, tf: form.tf,
    detect: form.detect, exit: form.exit,
    fills: form.fills, spreadPoints: Number(form.spreadPoints) || 0,
    ...extra,
  });

  const post = async (route, payload) => {
    const r = await fetch(`/api/ko/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  };

  const doProbe = async () => {
    if (!form.symbolId) return;
    setBusy('probe'); setError(null);
    try {
      setProbe(await post('probe', body({ ...windows.is, slMarginPts: form.exit.slMarginPts })));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const doRun = async () => {
    if (!form.symbolId) return;
    setBusy('run'); setError(null);
    try {
      const firstN = Number(form.firstN) || 0;
      const [is, oos, full] = await Promise.all(
        ['is', 'oos', 'full'].map(w => post('run', body({ ...windows[w], firstN, limit: 0 }))));
      setRuns({ is, oos, full });
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const doNull = async () => {
    if (!form.symbolId) return;
    setBusy('null'); setError(null);
    try {
      const w = windows[form.nullWindow] ?? windows.full;
      setNul(await post('null', body({ ...w, draws: Number(form.draws) || 60 })));
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const doSave = async () => {
    if (!form.symbolId) return;
    setBusy('save'); setError(null);
    try {
      const brief = s => s && ({
        n: s.resolvedAll, tp: s.tp, sl: s.sl, be: s.be, winrate: s.winrate,
        beThresh: s.beThresh, expPts: s.expPts, tStat: s.tStat, netPts: s.netPts,
        profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : null,
        maxDD: s.maxDD, riskMed: s.riskMed,
      });
      await post('configs', body({
        name: form.name || 'base', status: form.status, notes: form.notes || null,
        metrics: runs ? {
          is: brief(runs.is.stats), oos: brief(runs.oos.stats), full: brief(runs.full.stats),
          isWindow: windows.is, oosWindow: windows.oos, savedAt: new Date().toISOString(),
        } : null,
        // Le verdict du contrôle voyage avec le réglage : sans lui, un statut
        // « validé » ne dit pas si le gain se distingue du hasard.
        nullCheck: nul ? { window: form.nullWindow, draws: nul.meta.draws, ...nul.verdict } : null,
      }));
      const c = await reload();
      const saved = c.find(x => x.symbolId === form.symbolId && x.tf === form.tf && x.name === (form.name || 'base'));
      if (saved) setSel({ symbolId: saved.symbolId, tf: saved.tf, name: saved.name });
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const doDelete = async c => {
    setBusy('delete');
    try {
      await fetch(`/api/ko/configs?id=${c.id}`, { method: 'DELETE' });
      await reload();
      if (sel && sel.symbolId === c.symbolId && sel.tf === c.tf && sel.name === c.name) setSel(null);
    } catch (e) { setError(e.message); } finally { setBusy(null); }
  };

  const current = configs.find(c =>
    sel && c.symbolId === sel.symbolId && c.tf === sel.tf && c.name === sel.name) ?? null;

  const oos = runs?.oos?.stats;
  const isS = runs?.is?.stats;

  // Budget de liberté : ce que l'in-sample peut porter. Il ne connaît pas le
  // nombre de paramètres qu'on a réellement réglés (personne ne le sait à part
  // l'utilisateur) — il donne le plafond, et c'est à lui de compter.
  const budget = probe ? Math.floor(probe.signals.count / POSITIONS_PER_PARAM) : null;

  return (
    <div className={styles.page}>
      <Head><title>Réglages KO — Grapher</title></Head>

      <header className={styles.header}>
        <Link href="/" className={styles.logoLink}>
          <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <rect x="1" y="11" width="3" height="10" rx="1" fill="#F59E0B" />
            <rect x="7" y="6" width="3" height="15" rx="1" fill="#26A69A" />
            <rect x="13" y="3" width="3" height="18" rx="1" fill="#F59E0B" />
            <rect x="19" y="8" width="3" height="13" rx="1" fill="#26A69A" />
          </svg>
          <span className={styles.logoText}>GRAPHER</span>
        </Link>
        <span className={styles.headerTitle}>RÉGLAGES KO</span>
        <span className={styles.headerNote}>
          <Link href="/rfvg" style={{ color: 'inherit' }}>rFVG</Link>
          {' · '}
          <Link href="/rapports" style={{ color: 'inherit' }}>rapports JSON</Link>
        </span>
      </header>

      <div className={styles.shell}>
        {/* ── Symboles à l'étude ─────────────────────────────────────────── */}
        <aside className={styles.side}>
          <span className={styles.sideTitle}>symboles à l'étude</span>
          <div className={styles.symList}>
            {configs.map(c => {
              const st = STATUS[c.status] ?? STATUS.draft;
              const m  = c.metrics?.oos;
              const on = sel && c.symbolId === sel.symbolId && c.tf === sel.tf && c.name === sel.name;
              return (
                <button key={c.id} onClick={() => openConfig(c)}
                  className={`${styles.symRow}${on ? ` ${styles.symRowOn}` : ''}`}>
                  <span className={styles.symRowTop}>
                    <span className={styles.symName}>{c.symbol ?? `#${c.symbolId}`}</span>
                    <span className={styles.symTf}>{c.tf}</span>
                    <span className={styles.badge} style={{ color: st.color, background: `${st.color}1A` }}>
                      {st.label}
                    </span>
                  </span>
                  <span className={styles.symMeta}>
                    {c.name !== 'base' && `${c.name} · `}
                    TP {c.exit?.tpPts ?? '—'} · SL +{c.exit?.slMarginPts ?? '—'}
                    {c.exit?.beTriggerPts ? ` · BE ${c.exit.beTriggerPts}` : ''}
                  </span>
                  <span className={styles.symMeta} style={{ color: m ? (m.expPts >= 0 ? BULL : BEAR) : 'var(--text-dim)' }}>
                    {m ? `OOS ${pts(m.expPts, 3)} · n=${m.n} · t=${fmt(m.tStat)}` : 'jamais mesuré hors échantillon'}
                  </span>
                  <span className={styles.symMeta} style={{ color: c.nullCheck ? (c.nullCheck.pValue <= 0.05 ? BULL : AMBER) : 'var(--text-dim)' }}>
                    {c.nullCheck ? `décalage : p = ${fmt(c.nullCheck.pValue, 3)}` : 'pas de contrôle par décalage'}
                  </span>
                </button>
              );
            })}
            {!configs.length && (
              <p className={styles.empty}>
                Aucun symbole enregistré. Choisis-en un ci-dessous, calibre ses sorties,
                contrôle-le par décalage, puis enregistre.
              </p>
            )}
          </div>

          <span className={styles.sideTitle}>ajouter un symbole</span>
          <select className={styles.select} value="" onChange={e => e.target.value && addSymbol(e.target.value)}>
            <option value="">choisir…</option>
            {symbols.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.bar_count.toLocaleString('fr-FR')} M1)</option>
            ))}
          </select>

          {current && (
            <button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy}
              onClick={() => doDelete(current)}>
              Supprimer ce réglage
            </button>
          )}
        </aside>

        {/* ── Éditeur ────────────────────────────────────────────────────── */}
        <main className={styles.main}>
          {!form.symbolId ? (
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Le motif KO, et comment on le règle</h2>
              <p className={styles.cardSub}>
                Deux bougies. <b>B1</b> : une impulsion <b>pleine</b> (corps ≥ 1,3 × ATR et corps ≥ 90 %
                de son amplitude), entièrement <b>sous les deux MM</b> si elle est haussière,
                entièrement <b>au-dessus</b> si elle est baissière — c'est le retournement.
                <b> B2</b> : une respiration, sens indifférent, corps ≤ 0,3 × ATR et ≤ 30 % de son
                amplitude. Entrée au marché à l'ouverture de la 3e bougie, stop structurel posé à sa
                clôture sous/sur l'extrême B2–B3. La grosse bougie n'entre pas dans le stop.
              </p>
              <p className={styles.cardSub}>
                Ordre de travail : <b>Sonder</b> (échelle du symbole et budget de liberté),
                <b> Simuler</b> (IS / OOS / complet), <b>Contrôler</b> (décalage circulaire), puis
                <b> Enregistrer</b>. Les balayages systématiques — <i>y compris ceux de la
                détection, ce que le rFVG interdit</i> — se font en ligne de commande :
                <span className={styles.mono}> node scripts/ko-opt.mjs --help</span>.
              </p>
              <p className={styles.caveat}>
                Deux chiffres décident, jamais un seul : l'<b>out-of-sample</b> (aucun paramètre n'y
                a été réglé) et le <b>contrôle par décalage</b> (les mêmes signaux à des dates
                d'entrée décalées). Le second est indispensable ici : quand la détection est
                balayable, le nombre d'essais explose, et avec assez d'essais on trouve toujours un
                beau réglage.
              </p>
            </section>
          ) : (
            <>
              {/* Identité */}
              <section className={styles.card}>
                <div className={styles.row}>
                  <div className={styles.grow}>
                    <h2 className={styles.cardTitle}>{symbol?.name ?? `#${form.symbolId}`}</h2>
                    <p className={styles.cardSub} style={{ margin: 0 }}>
                      {symbol && `${symbol.bar_count.toLocaleString('fr-FR')} bougies M1 · ${symbol.ts_min.slice(0, 10)} → ${symbol.ts_max.slice(0, 10)}`}
                      {windows && ` · IS jusqu'au ${day(windows.cut)}, OOS après`}
                    </p>
                  </div>
                  <button className={styles.btn} disabled={busy} onClick={doProbe}>
                    {busy === 'probe' ? '…' : 'Sonder'}
                  </button>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy} onClick={doRun}>
                    {busy === 'run' ? '…' : 'Simuler'}
                  </button>
                  <button className={styles.btn} disabled={busy} onClick={doNull}>
                    {busy === 'null' ? '…' : 'Contrôler'}
                  </button>
                  <button className={styles.btn} disabled={busy} onClick={doSave}>
                    {busy === 'save' ? '…' : 'Enregistrer'}
                  </button>
                </div>

                <div className={styles.fields} style={{ marginTop: 14 }}>
                  <div className={styles.field}>
                    <label className={styles.label}>Timeframe</label>
                    <select className={styles.select} value={form.tf}
                      onChange={e => { setF({ tf: e.target.value }); setRuns(null); setProbe(null); setNul(null); }}>
                      {TFS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span className={styles.hint}>le motif se lit sur ces bougies — le changer change tout</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Nom du réglage</label>
                    <input className={styles.input} value={form.name}
                      onChange={e => setF({ name: e.target.value })} />
                    <span className={styles.hint}>plusieurs variantes par symbole/TF sont possibles</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Statut</label>
                    <select className={styles.select} value={form.status}
                      onChange={e => setF({ status: e.target.value })}>
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <span className={styles.hint}>{STATUS[form.status]?.hint}</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Spread (points)</label>
                    <input type="number" className={styles.input} value={form.spreadPoints} min={0} step="any"
                      onChange={e => setF({ spreadPoints: e.target.value })} />
                    <span className={styles.hint}>coût fixe déduit de chaque position. À 0, tout paraît rentable</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Résolution intra-bougie</label>
                    <select className={styles.select} value={form.fills}
                      onChange={e => setF({ fills: e.target.value })}>
                      <option value="bar">bougie — stop prioritaire (comme le graphe)</option>
                      <option value="m1">minute — ordre réel à la minute près</option>
                    </select>
                    <span className={styles.hint}>
                      « bougie » reproduit le rapport du graphe ; « minute » lève l'arbitrage quand
                      stop et TP tombent dans la même bougie
                    </span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Découpage IS / OOS</label>
                    <input type="number" className={styles.input} value={form.split} min={0.3} max={0.9} step={0.05}
                      onChange={e => setF({ split: Number(e.target.value) })} />
                    <span className={styles.hint}>part des données servant à régler ; le reste juge</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Limiter aux N premières positions</label>
                    <input type="number" className={styles.input} value={form.firstN} min={0} step={10}
                      onChange={e => setF({ firstN: Number(e.target.value) })} />
                    <span className={styles.hint}>0 = toutes. Échantillon chronologique, pas un tirage</span>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Contrôle — fenêtre et tirages</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select className={styles.select} value={form.nullWindow}
                        onChange={e => { setF({ nullWindow: e.target.value }); setNul(null); }}>
                        <option value="full">complet</option>
                        <option value="oos">out-of-sample</option>
                        <option value="is">in-sample</option>
                      </select>
                      <input type="number" className={styles.input} value={form.draws} min={10} max={400} step={10}
                        onChange={e => setF({ draws: Number(e.target.value) })} />
                    </div>
                    <span className={styles.hint}>
                      le contrôle se lit sur la MÊME fenêtre que la conclusion qu'on veut en tirer
                    </span>
                  </div>
                </div>
              </section>

              {error && <div className={styles.error}>{error}</div>}

              {/* Sonde */}
              {probe && (
                <section className={styles.card}>
                  <h2 className={styles.cardTitle}>Échelle de l'instrument et budget de liberté</h2>
                  <p className={styles.cardSub}>
                    Mesurée sur l'in-sample. C'est elle qui donne un sens aux points : le TP se
                    raisonne en multiples du <b>risque structurel médian</b>, pas dans l'absolu.
                  </p>
                  <div className={styles.tiles}>
                    <Tile label="Signaux" value={probe.signals.count}
                      color={probe.signals.count < 100 ? AMBER : undefined}
                      sub={`${probe.signals.perDay}/jour · ${probe.signals.bull} haussiers / ${probe.signals.bear} baissiers`} />
                    <Tile label="Budget de liberté" value={budget != null ? `${budget} param.` : '—'}
                      color={budget != null && budget < 3 ? BEAR : budget != null && budget < 6 ? AMBER : BULL}
                      sub={`à ${POSITIONS_PER_PARAM} positions par paramètre réglé — détection COMPRISE`} />
                    <Tile label="Risque médian" value={fmt(probe.risk.median, 2)}
                      sub={`p10 ${fmt(probe.risk.p10, 1)} · p90 ${fmt(probe.risk.p90, 1)} · étendue ${fmt(probe.risk.min, 1)} → ${fmt(probe.risk.max, 1)}`} />
                    <Tile label="TP à explorer" value={`${fmt(probe.risk.median * 0.5, 1)} → ${fmt(probe.risk.median * 4, 1)}`}
                      sub="0,5× à 4× le risque médian" />
                    <Tile label="Amplitude/bougie" value={fmt(probe.barRange.median, 2)}
                      sub={`p25 ${fmt(probe.barRange.p25, 1)} · p75 ${fmt(probe.barRange.p75, 1)}`} />
                    <Tile label="Spread observé" value={probe.spread ? fmt(probe.spread.priceMedian, 2) : '—'}
                      sub={probe.spread ? `médiane du broker · p90 ${fmt(probe.spread.priceP90, 2)} — à reporter dans « Spread »` : 'absent de l’export'} />
                    <Tile label="Buy & hold" value={pts(probe.buyHoldPts, 0)}
                      color={probe.buyHoldPts >= 0 ? BULL : BEAR}
                      sub="dérive de l'instrument sur la fenêtre — le repère à battre" />
                  </div>
                  {probe.signals.count < 100 && (
                    <p className={styles.warn} style={{ marginTop: 12 }}>
                      Moins de 100 signaux sur l'in-sample : régler plus de {budget} paramètre(s) sur
                      cet échantillon, c'est mémoriser l'historique. Baisser le timeframe, assouplir
                      la détection (atrMult1, bodyRatio1…) ou élargir la période avant d'optimiser.
                    </p>
                  )}
                </section>
              )}

              {/* Résultats */}
              {runs && (
                <>
                  <section className={styles.card}>
                    <h2 className={styles.cardTitle}>Résultat hors échantillon</h2>
                    <p className={styles.cardSub}>
                      Fenêtre {day(windows.oos.from)} → fin des données. Aucun paramètre n'a été
                      réglé dessus — mais un bon chiffre ici ne conclut rien tant que le contrôle par
                      décalage n'a pas parlé.
                    </p>
                    <div className={styles.tiles}>
                      <Tile label="Positions" value={oos.resolvedAll}
                        color={oos.resolvedAll < 30 ? AMBER : undefined}
                        sub={`TP ${oos.tp} · SL ${oos.sl} · BE ${oos.be}${oos.timeout ? ` · timeout ${oos.timeout}` : ''} · ${oos.open} ouverte(s)`} />
                      <Tile label="Espérance" value={pts(oos.expPts, 3)}
                        color={oos.expPts >= 0 ? BULL : BEAR} sub="par position, spread déduit" />
                      <Tile label="t-stat" value={fmt(oos.tStat)}
                        color={Math.abs(oos.tStat ?? 0) >= 2 ? BULL : AMBER}
                        sub="|t| ≳ 2 = distinguable du bruit" />
                      <Tile label="Winrate" value={pct(oos.winrate)}
                        color={oos.winrate != null && oos.beThresh != null ? (oos.winrate >= oos.beThresh ? BULL : BEAR) : undefined}
                        sub={`seuil de rentabilité réalisé ${pct(oos.beThresh)}`} />
                      <Tile label="Facteur de profit" value={fmt(oos.profitFactor)}
                        color={oos.profitFactor >= 1 ? BULL : BEAR}
                        sub={`gain moyen ${fmt(oos.avgWin, 1)} / perte ${fmt(oos.avgLoss, 1)}`} />
                      <Tile label="Drawdown max" value={pts(-oos.maxDD, 1)} color={BEAR}
                        sub={`${oos.maxLossStreak} pertes d'affilée au pire`} />
                    </div>
                  </section>

                  <section className={styles.card}>
                    <h2 className={styles.cardTitle}>In-sample, out-of-sample, complet</h2>
                    <p className={styles.cardSub}>
                      L'écart entre les deux premières lignes est le prix du surapprentissage. Une
                      espérance qui s'effondre en OOS n'était pas un edge, c'était un ajustement.
                    </p>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>fenêtre</th><th>période</th><th>n</th><th>TP/SL/BE</th>
                            <th>winrate</th><th>seuil</th><th>espérance</th><th>t</th>
                            <th>PF</th><th>DD max</th><th>net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[['in-sample', 'is'], ['OUT-OF-SAMPLE', 'oos'], ['complet', 'full']].map(([label, k]) => {
                            const s = runs[k].stats, m = runs[k].meta;
                            return (
                              <tr key={k} className={k === 'oos' ? styles.bestRow : (k === 'full' ? styles.baseRow : '')}>
                                <td>{label}</td>
                                <td>{day(m.from)} → {day(m.to) === '—' ? 'fin' : day(m.to)}</td>
                                <td>{s.resolvedAll}</td>
                                <td>{s.tp}/{s.sl}/{s.be}</td>
                                <td>{pct(s.winrate)}</td>
                                <td>{pct(s.beThresh)}</td>
                                <td style={{ color: s.expPts >= 0 ? BULL : BEAR }}>{fmt(s.expPts, 3)}</td>
                                <td>{fmt(s.tStat)}</td>
                                <td>{fmt(s.profitFactor)}</td>
                                <td>{fmt(-s.maxDD, 1)}</td>
                                <td>{fmt(s.netPts, 1)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {runs.full.meta.ambiguousExits > 0 && (
                      <p className={styles.cardSub} style={{ marginTop: 12, marginBottom: 0 }}>
                        <b>{runs.full.meta.ambiguousExits}</b> position(s) sont sorties sur une
                        {form.fills === 'm1' ? ' minute' : ' bougie'} où le stop <i>et</i> le TP étaient touchés :
                        le simulateur a tranché pour le stop. En live l'arbitrage se fait au tick —
                        ce chiffre mesure ce que la convention coûte, pas ce que le marché fait.
                      </p>
                    )}
                    {runs.full.meta.skippedByCooldown > 0 && (
                      <p className={styles.cardSub} style={{ marginTop: 8, marginBottom: 0 }}>
                        Cooldown : <b>{runs.full.meta.skippedByCooldown}</b> signaux sautés,
                        dont <b>{runs.full.meta.skippedWon}</b> auraient gagné.
                      </p>
                    )}
                  </section>
                </>
              )}

              {/* Contrôle par décalage circulaire */}
              {nul && (() => {
                const v = nul.verdict;
                const passe = v.pValue != null && v.pValue <= 0.05;
                return (
                  <section className={styles.card}>
                    <h2 className={styles.cardTitle}>Contrôle par décalage circulaire
                      <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> — {nul.meta.draws} tirages, fenêtre {form.nullWindow}</span>
                    </h2>
                    <p className={styles.cardSub}>
                      Mêmes signaux, mêmes sorties, mêmes proportions — seules les dates d'entrée
                      sont décalées en circulaire. Ce que les contrôles gagnent, c'est ce que la
                      géométrie du stop et du TP rapporte sur cet instrument <i>sans</i> le motif.
                    </p>
                    <div className={styles.tiles}>
                      <Tile label="Espérance réelle" value={pts(v.realExpPts, 3)}
                        color={v.realExpPts >= 0 ? BULL : BEAR} sub={`${nul.real.n} positions`} />
                      <Tile label="Nuage de contrôle" value={pts(v.controlMedian, 3)}
                        sub={`p05 ${fmt(v.controlP05, 2)} · p95 ${fmt(v.controlP95, 2)} · étendue ${fmt(v.controlMin, 1)} → ${fmt(v.controlMax, 1)}`} />
                      <Tile label="p empirique" value={fmt(v.pValue, 3)}
                        color={passe ? BULL : BEAR}
                        sub={`le motif bat ${pct(v.betterThan)} des contrôles`} />
                      <Tile label="p sur le t-stat" value={fmt(v.tStatPValue, 3)}
                        color={v.tStatPValue != null && v.tStatPValue <= 0.05 ? BULL : AMBER}
                        sub={`t réel ${fmt(v.realTStat)} · médiane des contrôles ${fmt(v.tStatControlMedian)}`} />
                    </div>
                    <p className={passe ? styles.cardSub : styles.warn} style={{ marginTop: 12, marginBottom: 0 }}>
                      {passe
                        ? "Le réglage sort du nuage (p ≤ 0,05). C'est la condition minimale pour continuer — pas une preuve : le contrôle ne casse ni la saisonnalité intra-journalière ni l'autocorrélation de la volatilité."
                        : "Le réglage ne se distingue pas de ses contrôles : à ce stade il mesure la géométrie du stop et du TP sur cet instrument, pas le motif KO. Aucun chiffre de la simulation ne doit être présenté comme un edge."}
                    </p>
                  </section>
                );
              })()}

              {/* Études — sur la période complète, là où il y a le plus de matière */}
              {runs && (
                <>
                  <div className={styles.twoCol}>
                    <section className={styles.card}>
                      <h2 className={styles.cardTitle}>Où poser le break-even
                        <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> — borne optimiste</span>
                      </h2>
                      <p className={styles.cardSub}>
                        Seuils en points, reportables tels quels dans <span className={styles.mono}>beTriggerPts</span>.
                        Les perdantes sauvées sont certaines ; les gagnantes sont supposées intactes,
                        ce qui est optimiste — la vraie valeur est <i>sous</i> ces chiffres.
                      </p>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead><tr><th>seuil</th><th>perdantes sauvées</th><th>%</th><th>espérance</th></tr></thead>
                          <tbody>
                            <tr className={styles.baseRow}>
                              <td>sans BE</td><td>—</td><td>—</td><td>{fmt(runs.full.stats.expWL, 3)}</td>
                            </tr>
                            {runs.full.stats.beStudy.map(r => (
                              <tr key={r.t} className={r === runs.full.stats.bestBe ? styles.bestRow : ''}>
                                <td>{fmt(r.t, 1)} pts</td>
                                <td>{r.saved} / {runs.full.stats.sl}</td>
                                <td>{pct(r.pct)}</td>
                                <td>{fmt(r.exp, 3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className={styles.card}>
                      <h2 className={styles.cardTitle}>Et si le stop était plafonné
                        <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}> — borne pessimiste</span>
                      </h2>
                      <p className={styles.cardSub}>
                        Le stop est structurel : sa distance varie du simple au décuple. Plafonner
                        coûte des gagnantes et sauve des perdantes — les paliers suivent les déciles
                        du risque observé. Au dernier, plus rien n'est plafonné.
                      </p>
                      <div className={styles.tableWrap}>
                        <table className={styles.table}>
                          <thead><tr><th>plafond</th><th>rognées</th><th>gagnantes tuées</th><th>espérance</th></tr></thead>
                          <tbody>
                            {runs.full.stats.slStudy.map((r, i) => (
                              <tr key={r.d} className={r === runs.full.stats.bestSl ? styles.bestRow
                                : (i === runs.full.stats.slStudy.length - 1 ? styles.baseRow : '')}>
                                <td>{fmt(r.d, 1)} pts{i === runs.full.stats.slStudy.length - 1 ? ' (aucun)' : ''}</td>
                                <td>{r.capped} / {runs.full.stats.resolved}</td>
                                <td>{r.killed} / {runs.full.stats.tp}</td>
                                <td>{fmt(r.exp, 3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>

                  <p className={styles.caveat}>
                    Les deux études sont des <b>bornes</b> construites sur les excursions globales de
                    chaque position : l'ordre intra-vie est inconnu à la granularité bougie. Un seuil
                    qui ressort ici doit être <b>rejoué en simulation complète</b> (le remettre dans le
                    formulaire, re-simuler) avant d'être retenu — sans quoi on lit une borne comme un
                    résultat.
                    {isS && oos && isS.expPts > 0 && oos.expPts < isS.expPts * 0.5 && (
                      <> <b style={{ color: AMBER }}>Ici l'espérance perd {pct(1 - oos.expPts / isS.expPts)} entre
                      l'in-sample et l'out-of-sample : le réglage est fragile.</b></>
                    )}
                  </p>
                </>
              )}

              {/* Paramètres */}
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Sorties — ce qui se calibre par symbole</h2>
                <p className={styles.cardSub}>
                  Le stop n'est pas une distance : il est <b>structurel</b>, posé à la clôture de la
                  bougie d'entrée sous/sur l'extrême B2–B3. Seule sa <b>marge</b> se règle. Le risque
                  varie donc d'une position à l'autre — c'est pourquoi tout se compte en points, à
                  lot fixe, et pas en R. Ces réglages sont exactement ceux du rFVG : les deux motifs
                  partagent le même moteur de sortie, donc un écart entre eux vient du motif.
                </p>
                <div className={styles.fields}>
                  {EXIT_SCHEMA.map(s => (
                    <Field key={s.key} spec={s} value={form.exit[s.key]}
                      onChange={v => { setE(s.key, v); setRuns(null); setNul(null); }} />
                  ))}
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Détection — le motif</h2>
                <p className={styles.cardSub}>
                  Contrairement au rFVG, ces seuils <b>peuvent</b> se régler : ils sont neufs, et les
                  figer sans les avoir mesurés reviendrait à optimiser autour d'une supposition.
                  Chacun d'eux consomme du <b>budget de liberté</b> (cf. la sonde) au même titre
                  qu'un paramètre de sortie, et tout réglage de détection retenu doit passer le
                  contrôle par décalage. Balayage systématique :
                  <span className={styles.mono}> node scripts/ko-opt.mjs sweep &lt;symbole&gt; --detect atrMult1 --values 0.8:2:0.2</span>
                </p>
                <div className={styles.fields}>
                  {DETECT_SCHEMA.map(s => (
                    <Field key={s.key} spec={s} value={form.detect[s.key]}
                      onChange={v => { setD(s.key, v); setRuns(null); setProbe(null); setNul(null); }} />
                  ))}
                </div>
              </section>

              <section className={styles.card}>
                <h2 className={styles.cardTitle}>Notes</h2>
                <textarea className={styles.input} rows={3} value={form.notes}
                  onChange={e => setF({ notes: e.target.value })}
                  placeholder="Ce qui a été testé, ce qui a été écarté, et pourquoi." />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
