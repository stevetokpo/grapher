// /rsi — LE LABORATOIRE DE LA CORNE.
//
// Cette page n'est plus seulement un tracé de RSI : c'est l'atelier où l'on
// transforme « ça ressemble à une corne pointue » en chiffres discutables.
//
// La boucle de travail, dans l'ordre :
//   1. régler le RSI (période 7) et l'amplitude du zigzag qui découpe les jambes ;
//   2. SURVOLER les pointes — chaque survol affiche les mesures de la corne et
//      surligne les deux jambes que la mesure a découpées ;
//   3. MARQUER à la souris les vraies cornes, et surtout les contre-exemples,
//      qui partent dans data/rsi-samples.json avec leur fenêtre de bougies ;
//   4. lire la COMPARAISON dans le panneau : les mesures dont la médiane des
//      cornes s'écarte du reste sont celles qui méritent un seuil ;
//   5. poser ces seuils dans la barre et regarder les candidats s'allumer sur le
//      graphe — ce qu'attrape le détecteur devient vérifiable d'un coup d'œil.
//
// Le fichier d'échantillons est ensuite exploitable hors ligne :
//   node scripts/rsi-lab.mjs

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useSymbols }      from '../hooks/useSymbols';
import { useBars }         from '../hooks/useBars';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { scanHorns, HORN_RULES, PIVOT_DEFAULTS } from '../lib/rsi/features';
import AppHeader           from '../components/layout/AppHeader';
import HornPanel           from '../components/rsi/HornPanel';
import styles              from '../styles/rsi.module.css';

const RsiChart = dynamic(() => import('../components/charts/RsiChart'), { ssr: false });

const TIMEFRAMES = ['1m','3m','5m','10m','15m','20m','30m','1h','2h','4h','1D'];

const RSI_COLORS = [
  { c: '#F472B6', label: 'Rose'   },
  { c: '#60A5FA', label: 'Bleu'   },
  { c: '#A78BFA', label: 'Violet' },
  { c: '#34D399', label: 'Vert'   },
  { c: '#F59E0B', label: 'Ambre'  },
  { c: '#FB923C', label: 'Orange' },
];

// Les seuils réglables depuis la barre. `step` sert aussi de granularité au
// clavier ; l'aide dit ce que le seuil coupe, pas ce qu'il vaut.
const RULE_FIELDS = [
  { key: 'minRiseBars',     label: 'montée ≥',   step: 1,   help: 'bougies de la jambe lente' },
  { key: 'maxDropBars',     label: 'chute ≤',    step: 1,   help: 'bougies de la jambe brutale' },
  { key: 'minRiseAmp',      label: 'hauteur ≥',  step: 1,   help: 'points de RSI entre le creux et la pointe' },
  { key: 'minSharpness',    label: 'pointe ≥',   step: 0.5, help: 'pente de chute ÷ pente de montée' },
  { key: 'minRewind',       label: 'rembob. ≥',  step: 1,   help: 'bougies passées effacées par la chute' },
  { key: 'minRewindPerBar', label: '/bougie ≥',  step: 0.5, help: 'bougies effacées par bougie de chute' },
  { key: 'minRetrace',      label: 'retour ≥',   step: 0.1, help: 'part de la montée rendue (1 = tout)' },
];

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export default function RsiPage() {
  const router = useRouter();
  const { symbols, symbolId, setSymbolId, currentSym } = useSymbols();

  const [tfId,       setTfId]       = useLocalStorage('grapher.rsi.tf',         '1m');
  const [period,     setPeriod]     = useLocalStorage('grapher.rsi.period',      7);
  const [overbought, setOverbought] = useLocalStorage('grapher.rsi.overbought', 70);
  const [oversold,   setOversold]   = useLocalStorage('grapher.rsi.oversold',   30);
  const [color,      setColor]      = useLocalStorage('grapher.rsi.color', '#F472B6');
  const [minAmp,     setMinAmp]     = useLocalStorage('grapher.rsi.minAmp', PIVOT_DEFAULTS.minAmp);
  const [rules,      setRules]      = useLocalStorage('grapher.rsi.rules', HORN_RULES);
  const [showCand,   setShowCand]   = useLocalStorage('grapher.rsi.showCand', true);
  const [panelOpen,  setPanelOpen]  = useLocalStorage('grapher.rsi.panel', true);

  const [mode,      setMode]      = useState('explore');   // 'explore' | 'mark'
  const [markLabel, setMarkLabel] = useState('oui');
  const [samples,   setSamples]   = useState([]);
  const [busy,      setBusy]      = useState(false);
  const [msg,       setMsg]       = useState(null);
  const [focusTime, setFocusTime] = useState(null);

  // Plus de bougies que la vue par défaut : une corne se juge sur son contexte,
  // et les statistiques du panneau ont besoin de pointes en nombre.
  const { allBars, loading, onLoadMore } = useBars(symbolId, tfId, 1500, 1000);

  // ── Le balayage : RSI, pivots, mesures de chaque pointe, verdict ────────
  const activeRules = useMemo(
    () => ({ ...HORN_RULES, ...rules, minAmp: Number(minAmp) || PIVOT_DEFAULTS.minAmp }),
    [rules, minAmp],
  );

  const scan = useMemo(() => {
    if (!allBars.length) return { rsi: [], pivots: [], horns: [], matches: [] };
    return scanHorns(allBars, { period, rules: activeRules });
  }, [allBars, period, activeRules]);

  // Le RSI au format du graphe — on saute le préchauffage.
  const series = useMemo(() => {
    const out = [];
    for (let i = 0; i < allBars.length; i++) {
      if (scan.rsi[i] != null) out.push({ time: allBars[i].time, value: scan.rsi[i] });
    }
    return out;
  }, [allBars, scan]);

  const currentRsi = series.length ? series[series.length - 1].value : null;

  const badgeClass = currentRsi == null ? ''
    : currentRsi >= overbought ? styles.rsiBadgeOb
    : currentRsi <= oversold   ? styles.rsiBadgeOs
    : styles.rsiBadgeNeutral;

  // ── Cahier d'échantillons ───────────────────────────────────────────────
  const loadSamples = useCallback(async () => {
    if (!symbolId) return;
    try {
      const r = await fetch(`/api/rsi/samples?symbolId=${symbolId}&tf=${tfId}&period=${period}`);
      const d = await r.json();
      setSamples(Array.isArray(d.samples) ? d.samples : []);
    } catch { /* le cahier reste tel quel */ }
  }, [symbolId, tfId, period]);

  useEffect(() => { loadSamples(); }, [loadSamples]);

  // Un clic en mode marquage : le serveur recalcule tout sur l'historique
  // COMPLET, aimante sur la pointe la plus proche et écrit l'échantillon.
  const onMarkClick = useCallback(async time => {
    if (!symbolId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/rsi/samples', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbolId, symbol: currentSym?.name ?? null,
          tf: tfId, period, minAmp: Number(minAmp),
          time, label: markLabel,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error ?? 'marquage refusé'); return; }

      setSamples(prev => {
        const next = prev.filter(s => s.id !== d.sample.id);
        next.push(d.sample);
        next.sort((a, b) => a.time - b.time);
        return next;
      });
      const f = d.sample.features;
      setMsg(`${markLabel === 'oui' ? 'corne' : 'contre-exemple'} marqué · montée ${f.riseBars}b, chute ${f.dropBars}b, pointe ×${f.sharpness}, rembobinage ${f.rewindBars}b`);
    } catch (e) {
      setMsg(`échec : ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [symbolId, currentSym, tfId, period, minAmp, markLabel]);

  const onDelete = useCallback(async smp => {
    setBusy(true);
    try {
      await fetch(`/api/rsi/samples?id=${encodeURIComponent(smp.id)}`, { method: 'DELETE' });
      setSamples(prev => prev.filter(s => s.id !== smp.id));
      setMsg('échantillon retiré');
    } catch (e) {
      setMsg(`échec : ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const onFocus = useCallback(smp => {
    setFocusTime(smp.time);
    const first = allBars[0]?.time;
    if (first && smp.time < first) {
      setMsg('échantillon plus ancien que les bougies chargées — remonte le graphe pour le voir');
    }
  }, [allBars]);

  const setRule = (key, value) => setRules(prev => ({ ...HORN_RULES, ...prev, [key]: value }));

  const onPeriodChange = e => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) setPeriod(clamp(v, 2, 500));
  };

  return (
    <div className={styles.shell}>
      <AppHeader
        symbols={symbols}
        symbolId={symbolId}
        onSymbolChange={setSymbolId}
        onImport={() => {}}
        onManage={() => {}}
        onSettings={() => {}}
        isRsiMode
        onBack={() => router.push('/')}
      />

      {/* ── Barre RSI ────────────────────────────────────────────── */}
      <div className={styles.configBar} role="toolbar" aria-label="Réglages du RSI">
        <span className={styles.intervalLabel}>INTERVAL</span>

        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            className={`${styles.tfBtn}${tf === tfId ? ` ${styles.tfBtnActive}` : ''}`}
            onClick={() => setTfId(tf)}
            aria-pressed={tf === tfId}
          >{tf}</button>
        ))}

        <div className={styles.spacer} />

        {currentRsi != null && (
          <span className={`${styles.rsiBadge} ${badgeClass}`}>{currentRsi.toFixed(1)}</span>
        )}

        <div className={styles.sep} />

        <div className={styles.configGroup}>
          <span className={styles.configLabel}>Période</span>
          <input
            type="number" className={styles.numInput} value={period}
            min={2} max={500} onChange={onPeriodChange} aria-label="Période RSI"
          />
          {period !== 7 && (
            <button className={styles.preset} onClick={() => setPeriod(7)} title="La corne se lit sur le RSI 7">
              7
            </button>
          )}
        </div>

        <div className={styles.sep} />

        <div className={styles.configGroup}>
          <span className={styles.configLabel} style={{ color: 'rgba(239,83,80,0.75)' }}>Surachat</span>
          <input
            type="number" className={styles.numInput} value={overbought}
            min={oversold + 1} max={99}
            onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setOverbought(clamp(v, oversold + 1, 99)); }}
            aria-label="Niveau de surachat"
          />
        </div>

        <div className={styles.sep} />

        <div className={styles.configGroup}>
          <span className={styles.configLabel} style={{ color: 'rgba(38,166,154,0.75)' }}>Survente</span>
          <input
            type="number" className={styles.numInput} value={oversold}
            min={1} max={overbought - 1}
            onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) setOversold(clamp(v, 1, overbought - 1)); }}
            aria-label="Niveau de survente"
          />
        </div>

        <div className={styles.sep} />

        <div className={styles.swatches} role="group" aria-label="Couleur RSI">
          {RSI_COLORS.map(({ c, label }) => (
            <button
              key={c}
              className={`${styles.swatch}${c === color ? ` ${styles.swatchActive}` : ''}`}
              style={{ '--sw': c }}
              onClick={() => setColor(c)}
              aria-pressed={c === color}
              aria-label={label} title={label}
            />
          ))}
        </div>
      </div>

      {/* ── Barre du labo ────────────────────────────────────────── */}
      <div className={styles.labBar} role="toolbar" aria-label="Outils de reconnaissance">
        <div className={styles.modeGroup}>
          <button
            className={`${styles.modeBtn}${mode === 'explore' ? ` ${styles.modeBtnActive}` : ''}`}
            onClick={() => setMode('explore')} aria-pressed={mode === 'explore'}
            title="Survoler les pointes pour lire leurs mesures"
          >Explorer</button>
          <button
            className={`${styles.modeBtn}${mode === 'mark' ? ` ${styles.modeBtnActive}` : ''}`}
            onClick={() => setMode('mark')} aria-pressed={mode === 'mark'}
            title="Cliquer une pointe pour l'enregistrer comme exemple"
          >Marquer</button>
        </div>

        {mode === 'mark' && (
          <div className={styles.modeGroup}>
            <button
              className={`${styles.labelBtn}${markLabel === 'oui' ? ` ${styles.labelBtnOui}` : ''}`}
              onClick={() => setMarkLabel('oui')} aria-pressed={markLabel === 'oui'}
            >✓ corne</button>
            <button
              className={`${styles.labelBtn}${markLabel === 'non' ? ` ${styles.labelBtnNon}` : ''}`}
              onClick={() => setMarkLabel('non')} aria-pressed={markLabel === 'non'}
            >✗ contre-ex.</button>
          </div>
        )}

        <div className={styles.sep} />

        <div className={styles.configGroup}>
          <span className={styles.configLabel} title="Repli minimum pour qu'une pointe existe (pts RSI)">Zigzag</span>
          <input
            type="number" className={styles.numInputSm} value={minAmp}
            min={0.5} max={40} step={0.5}
            onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) setMinAmp(clamp(v, 0.5, 40)); }}
            aria-label="Amplitude du zigzag"
          />
        </div>

        <div className={styles.sep} />

        {/* Les seuils du détecteur */}
        {RULE_FIELDS.map(({ key, label, step, help }) => (
          <div className={styles.configGroup} key={key} title={help}>
            <span className={styles.configLabel}>{label}</span>
            <input
              type="number" className={styles.numInputSm}
              value={activeRules[key]} step={step}
              onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) setRule(key, v); }}
              aria-label={`${label} ${help}`}
            />
          </div>
        ))}

        <div className={styles.configGroup}>
          <span className={styles.configLabel}>Sens</span>
          <select
            className={styles.select}
            value={activeRules.side}
            onChange={e => setRule('side', e.target.value)}
            aria-label="Sens du motif"
          >
            <option value="both">les deux</option>
            <option value="bear">corne ▼</option>
            <option value="bull">inversée ▲</option>
          </select>
        </div>

        <div className={styles.sep} />

        <button
          className={`${styles.toggle}${showCand ? ` ${styles.toggleOn}` : ''}`}
          onClick={() => setShowCand(v => !v)} aria-pressed={showCand}
          title="Afficher les pointes retenues par les seuils"
        >
          {scan.matches.length} / {scan.horns.length} candidats
        </button>

        <div className={styles.spacer} />

        {msg && <span className={styles.msg}>{msg}</span>}

        <button
          className={`${styles.toggle}${panelOpen ? ` ${styles.toggleOn}` : ''}`}
          onClick={() => setPanelOpen(v => !v)} aria-pressed={panelOpen}
        >Labo</button>
      </div>

      {/* ── Graphe + panneau ─────────────────────────────────────── */}
      <div className={styles.workArea}>
        <div className={styles.chartArea}>
          {loading && <p className={styles.chartEmpty}>Chargement…</p>}
          {!loading && series.length > 0 && (
            <RsiChart
              series={series}
              horns={scan.horns}
              samples={samples}
              onLoadMore={onLoadMore}
              overbought={overbought}
              oversold={oversold}
              color={color}
              mode={mode}
              markLabel={markLabel}
              showCandidates={showCand}
              focusTime={focusTime}
              onMarkClick={onMarkClick}
            />
          )}
          {!loading && series.length === 0 && symbolId && (
            <p className={styles.chartEmpty}>Pas assez de bougies pour un RSI {period}.</p>
          )}
        </div>

        {panelOpen && (
          <HornPanel
            samples={samples}
            horns={scan.horns}
            busy={busy}
            onFocus={onFocus}
            onDelete={onDelete}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
