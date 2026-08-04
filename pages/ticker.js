import { useMemo, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useSymbols }      from '../hooks/useSymbols';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTicks, useTickCoverage } from '../hooks/useTicks';
import {
  RESOLUTIONS, PRICE_SOURCES, isTickResolution, inferDigits,
  fmtClockMs, fmtDateMs,
} from '../lib/ticker/resolutions';
import { fmtCount } from '../lib/format';
import AppHeader from '../components/layout/AppHeader';
import styles    from '../styles/ticker.module.css';

const TickerChart = dynamic(() => import('../components/charts/TickerChart'), { ssr: false });

// Fin d'un jour en heure broker : sert de point d'arrivée au saut de date.
const DAY_MS = 86_400_000;

export default function TickerPage() {
  const router = useRouter();
  const { symbols, symbolId, setSymbolId, currentSym } = useSymbols();

  const [resId, setResId] = useLocalStorage('grapher.ticker.res', 'tick');
  const [src,   setSrc]   = useLocalStorage('grapher.ticker.src', 'mid');
  const [showBand,   setShowBand]   = useLocalStorage('grapher.ticker.band', true);
  const [showVolume, setShowVolume] = useLocalStorage('grapher.ticker.vol',  true);

  // Vue figée à une date (null = direct). Voir useTicks : le suivi en temps
  // réel est suspendu tant qu'une date est épinglée.
  const [pinnedTo, setPinnedTo] = useState(null);

  const isTick   = isTickResolution(resId);
  const coverage = useTickCoverage(symbolId);
  const { rows, loading, loadingMore, hasMore, error, onLoadMore, prepended } =
    useTicks(symbolId, resId, src, { pinnedTo });

  // La source « Last » n'a de sens que si l'instrument publie des transactions.
  // Sur un indice synthétique, MT5 n'envoie que des cotations : le bouton reste
  // visible mais inerte, plutôt que de produire un graphe vide sans explication.
  const hasLast = coverage?.hasLast ?? false;
  useEffect(() => {
    if (src === 'last' && coverage && !hasLast) setSrc('mid');
  }, [src, coverage, hasLast, setSrc]);

  // ── Fraîcheur ───────────────────────────────────────────────────────────
  // Mesurée sur l'ARRIVÉE des données, pas en comparant les horloges : les
  // horodatages sont en heure broker, dont on ignore le décalage. « Reçu il y
  // a 12 s » est vrai sans rien supposer ; « la dernière donnée date de 12 s »
  // ne le serait qu'avec le bon fuseau.
  const lastKey = rows.length ? (isTick ? rows[rows.length - 1].us : rows[rows.length - 1].time) : null;
  const recvRef = useRef(0);
  const [age, setAge] = useState(0);

  useEffect(() => {
    if (lastKey == null) return;
    recvRef.current = Date.now();
    setAge(0);
  }, [lastKey]);

  useEffect(() => {
    const id = setInterval(() => {
      if (recvRef.current) setAge(Math.floor((Date.now() - recvRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Lecture instantanée ─────────────────────────────────────────────────
  const readout = useMemo(() => {
    if (!rows.length) return null;
    const last = rows[rows.length - 1];

    if (isTick) {
      const spread = last.bid != null && last.ask != null ? last.ask - last.bid : null;
      // Le grand prix est CELUI QU'ON LIT : il suit la source choisie. Afficher
      // le bid pendant que le graphe trace le mid ferait diverger le chiffre et
      // la ligne, à quelques dixièmes de spread près.
      const price =
        src === 'bid'  ? last.bid  :
        src === 'ask'  ? last.ask  :
        src === 'last' ? last.last :
        (last.bid != null && last.ask != null ? (last.bid + last.ask) / 2 : last.bid ?? last.ask);
      // Débit : ticks de la dernière seconde pleine de données. Compté à
      // rebours, on s'arrête dès qu'on sort de la fenêtre.
      let n = 0;
      for (let i = rows.length - 1; i >= 0 && last.t - rows[i].t < 1000; i--) n++;
      return {
        price:  price ?? last.bid ?? last.ask ?? last.last,
        bid:    last.bid,
        ask:    last.ask,
        spread,
        rate:   n,
        stamp:  `${fmtDateMs(last.t)} ${fmtClockMs(last.t)}`,
        count:  rows.length,
      };
    }
    // En agrégé, la clôture est DÉJÀ celle de la source demandée : l'API
    // n'agrège que la colonne choisie.
    return {
      price:  last.close,
      bid:    null,
      ask:    null,
      spread: last.spread,
      rate:   last.ticks,
      stamp:  `${fmtDateMs(last.time * 1000)} ${fmtClockMs(last.time * 1000, { millis: false })}`,
      count:  rows.length,
    };
  }, [rows, isTick, src]);

  // Décimales de l'instrument, lues sur les cotations brutes côté serveur.
  // Elles servent à tout ce que le broker publie tel quel : bid, ask, spread.
  const baseDigits = useMemo(
    () => coverage?.digits
      ?? inferDigits(rows.map(r => (isTick ? (r.bid ?? r.ask ?? r.last) : r.close))),
    [coverage, rows, isTick],
  );

  // Le mid, lui, est une moyenne : il tombe sur le demi-point et réclame une
  // décimale de plus, sans quoi il s'afficherait arrondi. Cette décimale ne
  // vaut QUE pour lui — l'accorder au bid en ferait une cotation inventée.
  const digits = src === 'mid' ? Math.min(8, baseDigits + 1) : baseDigits;

  const fresh = age < 90 ? 'ok' : age < 300 ? 'warn' : 'stale';
  const viewKey = `${symbolId}|${resId}|${src}|${pinnedTo ?? 'live'}`;

  const onPickDay = e => {
    const v = e.target.value;
    if (!v) { setPinnedTo(null); return; }
    // On épingle la FIN du jour choisi : la vue s'ouvre sur sa dernière heure,
    // et la remontée dans l'histoire se fait ensuite en glissant vers la gauche.
    setPinnedTo(Number(v) + DAY_MS);
  };

  const pinnedDay = pinnedTo == null ? '' : String(pinnedTo - DAY_MS);

  return (
    <div className={styles.shell}>
      <AppHeader
        symbols={symbols}
        symbolId={symbolId}
        onSymbolChange={id => { setSymbolId(id); setPinnedTo(null); }}
        onImport={() => {}}
        onManage={() => {}}
        onSettings={() => {}}
        isTickerMode
        onBack={() => router.push('/')}
      />

      {/* ── Barre de réglages ────────────────────────────────────────── */}
      <div className={styles.bar} role="toolbar" aria-label="Réglages du ticker">
        <span className={styles.barLabel}>PAS</span>
        <div className={styles.segment}>
          {RESOLUTIONS.map(r => (
            <button
              key={r.id}
              className={`${styles.segBtn}${r.id === resId ? ` ${styles.segBtnOn}` : ''}${r.id === 'tick' ? ` ${styles.segBtnTick}` : ''}`}
              onClick={() => setResId(r.id)}
              aria-pressed={r.id === resId}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className={styles.sep} />

        <span className={styles.barLabel}>PRIX</span>
        <div className={styles.segment}>
          {PRICE_SOURCES.map(s => {
            const off = s.id === 'last' && !hasLast;
            return (
              <button
                key={s.id}
                className={`${styles.segBtn}${s.id === src ? ` ${styles.segBtnOn}` : ''}`}
                onClick={() => setSrc(s.id)}
                disabled={off}
                title={off ? "Cet instrument ne publie pas de prix de transaction" : undefined}
                aria-pressed={s.id === src}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <div className={styles.sep} />

        {isTick ? (
          <label className={styles.check}>
            <input type="checkbox" checked={showBand} onChange={e => setShowBand(e.target.checked)} />
            <span>Bid / Ask</span>
          </label>
        ) : (
          <label className={styles.check}>
            <input type="checkbox" checked={showVolume} onChange={e => setShowVolume(e.target.checked)} />
            <span>Volume</span>
          </label>
        )}

        <div className={styles.spacer} />

        {pinnedTo != null ? (
          <button className={styles.livePin} onClick={() => setPinnedTo(null)}>
            ⏸ Figé — revenir au direct
          </button>
        ) : (
          <span className={`${styles.live} ${styles[`live_${fresh}`]}`}>
            <span className={styles.dot} />
            DIRECT
            <em>{recvRef.current ? `reçu il y a ${age}s` : 'en attente'}</em>
          </span>
        )}
      </div>

      {/* ── Graphe ───────────────────────────────────────────────────── */}
      <div className={styles.chartArea}>
        {readout && (
          <div className={styles.readout}>
            <div className={styles.readPrice}>{Number(readout.price).toFixed(digits)}</div>
            <div className={styles.readGrid}>
              {isTick ? (
                <>
                  <Stat label="bid"    value={readout.bid  == null ? '—' : readout.bid.toFixed(baseDigits)} tone="bull" />
                  <Stat label="ask"    value={readout.ask  == null ? '—' : readout.ask.toFixed(baseDigits)} tone="bear" />
                  <Stat label="spread" value={readout.spread == null ? '—' : readout.spread.toFixed(baseDigits)} />
                  <Stat label="ticks/s" value={fmtCount(readout.rate)} />
                </>
              ) : (
                <>
                  <Stat label="ticks"  value={fmtCount(readout.rate)} />
                  <Stat label="spread" value={readout.spread == null ? '—' : readout.spread.toFixed(baseDigits)} />
                </>
              )}
            </div>
            <div className={styles.readStamp}>{readout.stamp}</div>
          </div>
        )}

        {loading && <p className={styles.center}>Chargement…</p>}

        {!loading && error && (
          <p className={`${styles.center} ${styles.error}`}>Erreur : {error}</p>
        )}

        {!loading && !error && rows.length > 0 && (
          <TickerChart
            rows={rows}
            isTick={isTick}
            src={src}
            showBand={showBand}
            showVolume={showVolume}
            digits={digits}
            baseDigits={baseDigits}
            viewKey={viewKey}
            onLoadMore={onLoadMore}
            prepended={prepended}
          />
        )}

        {!loading && !error && rows.length === 0 && symbolId != null && <EmptyState sym={currentSym} />}

        {loadingMore && <span className={styles.moreBadge}>chargement de l'historique…</span>}
      </div>

      {/* ── Pied : couverture ────────────────────────────────────────── */}
      <div className={styles.status}>
        {coverage && coverage.count > 0 ? (
          <>
            <span className={styles.statusStrong}>{fmtCount(coverage.count)}</span>
            <span>ticks</span>
            <span className={styles.statusDim}>·</span>
            <span>
              {fmtDateMs(coverage.firstMs)} {fmtClockMs(coverage.firstMs, { millis: false })}
              {' → '}
              {fmtDateMs(coverage.lastMs)} {fmtClockMs(coverage.lastMs, { millis: false })}
            </span>
            <span className={styles.statusDim}>·</span>
            <span>{coverage.days.length} jour{coverage.days.length > 1 ? 's' : ''}</span>

            <div className={styles.spacer} />

            <label className={styles.jump}>
              Aller à
              <select value={pinnedDay} onChange={onPickDay}>
                <option value="">Direct (dernières données)</option>
                {[...coverage.days].reverse().map(([d, c]) => (
                  <option key={d} value={d}>{fmtDateMs(d)} — {fmtCount(c)} ticks</option>
                ))}
              </select>
            </label>

            {!hasMore && rows.length > 0 && (
              <span className={styles.statusDim}>début de l'historique atteint</span>
            )}
          </>
        ) : (
          <span className={styles.statusDim}>
            {symbolId == null ? 'Aucun symbole' : 'Aucun tick enregistré pour ce symbole'}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue}${tone ? ` ${styles[`tone_${tone}`]}` : ''}`}>{value}</span>
    </div>
  );
}

// Le cas le plus fréquent à la première ouverture : la table est vide parce que
// l'EA n'a jamais tourné. Un graphe vide ne dit pas quoi faire — celui-ci si.
function EmptyState({ sym }) {
  return (
    <div className={styles.empty}>
      <h2>Aucun tick pour {sym?.name ?? 'ce symbole'}</h2>
      <p>
        Le ticker ne lit que des ticks enregistrés en direct. Il n'y a pas d'import :
        c'est l'expert MT5 qui les envoie, minute après minute.
      </p>
      <ol>
        <li>
          Copier <code>code/mql5/GrapherTicker.mq5</code> dans
          <code>MQL5/Experts</code> du terminal, puis compiler (F7).
        </li>
        <li>
          Terminal : <em>Outils › Options › Expert Advisors</em> → cocher
          « Autoriser WebRequest » et y ajouter l'URL du serveur.
        </li>
        <li>Attacher l'expert au graphe du symbole voulu, en autorisant le trading algorithmique.</li>
        <li>
          Le premier envoi part à la <strong>clôture de la minute en cours</strong> :
          comptez jusqu'à 60 secondes avant de voir la première bougie.
        </li>
      </ol>
      <p className={styles.emptyNote}>
        L'expert n'envoie que ce qu'il voit passer — il ne remonte aucun historique.
        Ce qui précède son attache n'existera pas ici.
      </p>
    </div>
  );
}
