import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useLocalStorage } from '../hooks/useLocalStorage';
import AppHeader       from '../components/layout/AppHeader';
import BacktestConfig  from '../components/backtest/BacktestConfig';
import BacktestResults from '../components/backtest/BacktestResults';
import appStyles from '../styles/app.module.css';
import styles    from '../styles/backtest.module.css';

function toDateInput(tsStr) {
  if (!tsStr) return '';
  return String(tsStr).slice(0, 10);
}

function toEpoch(dateStr, endOfDay = false) {
  const base = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
  return endOfDay ? base + 86399 : base;
}

const DEFAULT_CONFIG = {
  symbolId:   null,
  dateFrom:   '',
  dateTo:     '',
  tf:         '15m',
  strategyId: null,
  params:     {},           // { [strategyId]: { key: value } }
  execution:  { spreadPoints: 0, maxBarsInTrade: 0 },
};

export default function BacktestPage() {
  const router = useRouter();

  const [symbols,    setSymbols]    = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [loaded,     setLoaded]     = useState(false);

  // La config (TF, stratégie, params, spread) survit aux rechargements
  const [config, setConfig] = useLocalStorage('grapher.backtest.config', DEFAULT_CONFIG);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error,   setError]   = useState(null);

  // ── Chargement symboles + stratégies disponibles ─────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/symbols').then(r => r.json()),
      fetch('/api/backtest').then(r => r.json()),
    ])
      .then(([syms, strats]) => {
        setSymbols(syms);
        setStrategies(strats);
        setConfig(prev => {
          const next = { ...prev };
          // Compléter la config persistée si symbole/stratégie manquants ou disparus
          if (!syms.find(s => s.id === next.symbolId)) {
            next.symbolId = syms[0]?.id ?? null;
            next.dateFrom = toDateInput(syms[0]?.ts_min);
            next.dateTo   = toDateInput(syms[0]?.ts_max);
          }
          if (!strats.find(s => s.id === next.strategyId)) {
            next.strategyId = strats[0]?.id ?? null;
          }
          return next;
        });
      })
      .catch(err => setError(err.message))
      .finally(() => setLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pré-remplir les dates quand on change de symbole
  const handleConfigChange = next => {
    if (next.symbolId !== config.symbolId) {
      const sym = symbols.find(s => s.id === next.symbolId);
      if (sym) {
        next = { ...next, dateFrom: toDateInput(sym.ts_min), dateTo: toDateInput(sym.ts_max) };
      }
    }
    setConfig(next);
  };

  // ── Lancer un backtest ───────────────────────────────────────────────────
  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/backtest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbolId:   config.symbolId,
          from:       toEpoch(config.dateFrom),
          to:         toEpoch(config.dateTo, true),
          tf:         config.tf,
          strategyId: config.strategyId,
          params:     config.params?.[config.strategyId] ?? {},
          execution:  config.execution,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResults(data);
    } catch (err) {
      setResults(null);
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const currentSym = symbols.find(s => s.id === config.symbolId);

  return (
    <div className={appStyles.shell}>
      <AppHeader
        symbols={[]}
        symbolId={null}
        onSymbolChange={() => {}}
        onImport={() => {}}
        onManage={() => {}}
        onSettings={() => {}}
        isBacktestMode
        replaySymbolName={currentSym?.name ?? ''}
        onBack={() => router.push('/')}
      />

      <div className={styles.body}>
        {!loaded ? (
          <p className={styles.state}>Chargement…</p>
        ) : symbols.length === 0 ? (
          <p className={styles.state}>Aucun symbole importé — importez d'abord des données MT5.</p>
        ) : (
          <>
            <BacktestConfig
              symbols={symbols}
              strategies={strategies}
              config={config}
              onConfigChange={handleConfigChange}
              onRun={run}
              running={running}
            />

            <main className={styles.main}>
              {error && <p className={styles.error}>Erreur : {error}</p>}
              {!results && !error && !running && (
                <div className={styles.placeholder}>
                  <p className={styles.placeholderTitle}>Backtest de stratégies</p>
                  <p className={styles.placeholderText}>
                    Choisissez un symbole, une plage de dates, un timeframe et une stratégie,
                    ajustez les paramètres puis lancez le backtest. Les décisions sont prises
                    à la clôture de chaque bougie et les SL/TP sont vérifiés à la minute près
                    (bougies M1) à l'intérieur de chaque bougie.
                  </p>
                </div>
              )}
              {running && <p className={styles.state}>Backtest en cours…</p>}
              {results && !running && <BacktestResults results={results} />}
            </main>
          </>
        )}
      </div>
    </div>
  );
}
