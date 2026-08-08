import { useMemo, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useSymbols }      from '../hooks/useSymbols';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTicks, useTickCoverage } from '../hooks/useTicks';
import { useZones } from '../hooks/useZones';
import { detectFvg } from '../lib/ticker/fvg';
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

// Mêmes couleurs que le graphe (components/charts/TickerChart.js), pour que les
// pastilles de la barre d'outils désignent bien la courbe qu'on voit.
const MA_COLORS = ['#F59E0B', '#A78BFA', '#34D399', '#F472B6'];

function clampInt(raw, fallback, min = 1, max = 200) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export default function TickerPage() {
  const router = useRouter();
  const { symbols, symbolId, setSymbolId, currentSym } = useSymbols();

  const [resId, setResId] = useLocalStorage('grapher.ticker.res', 'tick');
  const [src,   setSrc]   = useLocalStorage('grapher.ticker.src', 'mid');
  const [showBand,   setShowBand]   = useLocalStorage('grapher.ticker.band', true);
  const [showVolume, setShowVolume] = useLocalStorage('grapher.ticker.vol',  true);

  // Indicateurs. Les périodes des moyennes se saisissent en une seule ligne
  // (« 20, 50, 200 ») : c'est ce qui tient dans une barre d'outils tout en
  // laissant en poser plusieurs, sans ouvrir un panneau pour deux réglages.
  const [smaText,    setSmaText]    = useLocalStorage('grapher.ticker.sma',    '');
  const [showSwings, setShowSwings] = useLocalStorage('grapher.ticker.swings', false);
  const [swingLeft,  setSwingLeft]  = useLocalStorage('grapher.ticker.swingL', 5);
  const [swingRight, setSwingRight] = useLocalStorage('grapher.ticker.swingR', 5);

  // Vue figée à une date (null = direct). Voir useTicks : le suivi en temps
  // réel est suspendu tant qu'une date est épinglée.
  const [pinnedTo, setPinnedTo] = useState(null);

  // Zones de support / résistance — rangées par symbole (voir useZones).
  const [zoneTool, setZoneTool] = useState(false);
  const [zoneKind, setZoneKind] = useLocalStorage('grapher.ticker.zoneKind', 'support');

  // Motifs détectés. Réglages séparés de ceux des zones tracées : ce sont deux
  // objets différents, l'un trouvé, l'autre décidé.
  const [showFvg,    setShowFvg]    = useLocalStorage('grapher.ticker.fvg',      false);
  const [showIfvg,   setShowIfvg]   = useLocalStorage('grapher.ticker.ifvg',     true);
  const [hideFilled, setHideFilled] = useLocalStorage('grapher.ticker.fvgFill',  false);
  const [fvgExt,     setFvgExt]     = useLocalStorage('grapher.ticker.fvgExt',   10);
  const [fvgLimit,   setFvgLimit]   = useLocalStorage('grapher.ticker.fvgMax',   12);
  const { zones, selectedId, setSelectedId, addZone, updateZone, removeZone, clearZones } =
    useZones(symbolId);

  // « 20, 50, 200 » → [20, 50, 200]. Tableau mémorisé sur le TEXTE : reconstruit
  // à chaque rendu, il ferait recréer les séries du graphe en boucle.
  const maPeriods = useMemo(() => {
    const seen = new Set();
    for (const part of String(smaText).split(/[,;\s]+/)) {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 5000) seen.add(n);
    }
    return [...seen].slice(0, 4);   // quatre courbes suffisent à saturer la lecture
  }, [smaText]);

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

  // ── FVG / iFVG ──────────────────────────────────────────────────────────
  // Un FVG est un trou entre deux MÈCHES. Au tick, une bougie n'a pas de mèche
  // — open = high = low = close — et la règle dégénère en « le prix a monté
  // depuis deux ticks », ce qui est vrai une fois sur deux et ne veut rien
  // dire. La détection ne tourne donc que sur les pas agrégés, et le panneau
  // le dit au lieu d'afficher zéro motif sans raison apparente.
  const fvgZones = useMemo(() => {
    if (isTick || (!showFvg && !showIfvg) || !rows.length) return [];
    return detectFvg(rows, { showFvg, showIfvg, hideFilled, extLen: fvgExt, limit: fvgLimit });
  }, [rows, isTick, showFvg, showIfvg, hideFilled, fvgExt, fvgLimit]);

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
  const selectedZone = zones.find(z => z.id === selectedId) ?? null;

  const onZoneCreate = (zone) => addZone(zone);

  // Suppr efface la zone sélectionnée — mais jamais pendant qu'on tape dans un
  // champ, sinon régler une période de moyenne effacerait un support.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = e => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeZone(selectedId); }
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, removeZone, setSelectedId]);

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

      {/* ── Barre de réglages ─────────────────────────────────────────────
          Trois groupes reliés à leur étiquette par un fond commun, plutôt
          qu'une file de contrôles séparés par des traits. Le regroupement se
          lit avant la lecture des mots : c'est ce qui manquait le plus ici.  */}
      <div className={styles.bar} role="toolbar" aria-label="Réglages du ticker">
        <div className={styles.group}>
          <span className={styles.groupLabel}>PAS</span>
          <div className={styles.seg}>
            {RESOLUTIONS.map(r => (
              <button
                key={r.id}
                // Le tick n'est pas « un pas plus court » : il n'agrège rien.
                // Il est détaché du reste de la série pour le dire sans mot.
                className={[
                  styles.segBtn,
                  r.id === resId ? styles.segBtnOn : '',
                  r.id === 'tick' ? styles.segBtnTick : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setResId(r.id)}
                aria-pressed={r.id === resId}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>PRIX</span>
          <div className={styles.seg}>
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
        </div>

        <IndicatorMenu
          isTick={isTick}
          smaText={smaText}        setSmaText={setSmaText}
          maPeriods={maPeriods}
          showSwings={showSwings}  setShowSwings={setShowSwings}
          swingLeft={swingLeft}    setSwingLeft={setSwingLeft}
          swingRight={swingRight}  setSwingRight={setSwingRight}
          showBand={showBand}      setShowBand={setShowBand}
          showVolume={showVolume}  setShowVolume={setShowVolume}
          showFvg={showFvg}        setShowFvg={setShowFvg}
          showIfvg={showIfvg}      setShowIfvg={setShowIfvg}
          hideFilled={hideFilled}  setHideFilled={setHideFilled}
          fvgExt={fvgExt}          setFvgExt={setFvgExt}
          fvgLimit={fvgLimit}      setFvgLimit={setFvgLimit}
          fvgCount={fvgZones.length}
        />

        <button
          className={`${styles.menuBtn}${zoneTool ? ` ${styles.toolOn}` : ''}`}
          onClick={() => { setZoneTool(t => !t); setSelectedId(null); }}
          aria-pressed={zoneTool}
          title="Tracer un rectangle : glisser sur le graphe"
        >
          <ZoneIcon />
          Zones
          {zones.length > 0 && <span className={styles.badge}>{zones.length}</span>}
        </button>

        {/* Le sens se choisit AVANT de tracer : la couleur du rectangle est une
            décision de lecture, pas une conséquence de l'endroit où on clique. */}
        {zoneTool && (
          <div className={styles.seg}>
            <button
              className={`${styles.kindBtn} ${styles.kindSupport}${zoneKind === 'support' ? ` ${styles.kindOn}` : ''}`}
              onClick={() => setZoneKind('support')}
              aria-pressed={zoneKind === 'support'}
            >
              Support
            </button>
            <button
              className={`${styles.kindBtn} ${styles.kindResistance}${zoneKind === 'resistance' ? ` ${styles.kindOn}` : ''}`}
              onClick={() => setZoneKind('resistance')}
              aria-pressed={zoneKind === 'resistance'}
            >
              Résistance
            </button>
          </div>
        )}

        <div className={styles.spacer} />

        {pinnedTo != null ? (
          <button className={styles.pinBtn} onClick={() => setPinnedTo(null)}>
            <PauseIcon />
            Figé
            <em>revenir au direct</em>
          </button>
        ) : (
          <span className={`${styles.live} ${styles[`live_${fresh}`]}`}>
            <span className={styles.dot} />
            DIRECT
            <em>{recvRef.current ? `${age}s` : '…'}</em>
          </span>
        )}
      </div>

      {/* ── Graphe ───────────────────────────────────────────────────── */}
      <div className={styles.chartArea}>
        {/* Panneau de lecture : posé SUR le graphe plutôt qu'au-dessus, parce
            que la hauteur vaut mieux aux bougies. Le prix domine, le reste se
            lit d'un coup d'œil sans le concurrencer. */}
        {readout && (
          <div className={styles.readout}>
            <div className={styles.readHead}>
              <span className={styles.readPrice}>{Number(readout.price).toFixed(digits)}</span>
              <span className={styles.readSrc}>{src}</span>
            </div>
            <div className={styles.readGrid}>
              {isTick ? (
                <>
                  <Stat label="bid"     value={readout.bid    == null ? '—' : readout.bid.toFixed(baseDigits)} tone="bull" />
                  <Stat label="ask"     value={readout.ask    == null ? '—' : readout.ask.toFixed(baseDigits)} tone="bear" />
                  <Stat label="spread"  value={readout.spread == null ? '—' : readout.spread.toFixed(baseDigits)} />
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
            maPeriods={maPeriods}
            showSwings={showSwings}
            swingLeft={swingLeft}
            swingRight={swingRight}
            zones={zones}
            fvgZones={fvgZones}
            zoneTool={zoneTool}
            zoneKind={zoneKind}
            selectedZoneId={selectedId}
            onZoneCreate={onZoneCreate}
            onZoneSelect={setSelectedId}
            viewKey={viewKey}
            onLoadMore={onLoadMore}
            prepended={prepended}
          />
        )}

        {/* Aide au tracé — n'apparaît qu'en mode zone et disparaît dès qu'une
            zone existe : une consigne qu'on a déjà suivie devient du bruit. */}
        {zoneTool && !selectedZone && (
          <span className={styles.hint}>
            {zones.length === 0
              ? `Glisser sur le graphe pour tracer un rectangle de ${zoneKind === 'support' ? 'support' : 'résistance'}`
              : <>Cliquer une zone pour la modifier
                  <button className={styles.hintBtn} onClick={clearZones}>tout effacer</button></>}
          </span>
        )}

        {selectedZone && (
          <div className={styles.zoneCard}>
            <div className={styles.zoneRange}>
              <b>{selectedZone.top.toFixed(baseDigits)}</b>
              <span>—</span>
              <b>{selectedZone.bottom.toFixed(baseDigits)}</b>
              <em>{(selectedZone.top - selectedZone.bottom).toFixed(baseDigits)}</em>
            </div>
            <div className={styles.zoneActions}>
              {/* Un support cassé devient une résistance. C'est à l'utilisateur
                  de dire quand, pas au programme de le deviner en continu. */}
              <button
                className={`${styles.kindBtn} ${styles.kindSupport}${selectedZone.kind === 'support' ? ` ${styles.kindOn}` : ''}`}
                onClick={() => updateZone(selectedZone.id, { kind: 'support' })}
                aria-pressed={selectedZone.kind === 'support'}
              >
                Support
              </button>
              <button
                className={`${styles.kindBtn} ${styles.kindResistance}${selectedZone.kind === 'resistance' ? ` ${styles.kindOn}` : ''}`}
                onClick={() => updateZone(selectedZone.id, { kind: 'resistance' })}
                aria-pressed={selectedZone.kind === 'resistance'}
              >
                Résistance
              </button>
              <button
                className={styles.zoneDelete}
                onClick={() => removeZone(selectedZone.id)}
                aria-label="Supprimer la zone"
                title="Supprimer (Suppr)"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        )}

        {!loading && !error && rows.length === 0 && symbolId != null && <EmptyState sym={currentSym} />}

        {loadingMore && <span className={styles.moreBadge}>chargement de l'historique…</span>}
      </div>

      {/* ── Pied : couverture ─────────────────────────────────────────────
          Des FAITS à gauche, une ACTION à droite. C'est la seule séparation
          dont ce bandeau a besoin pour cesser d'être une phrase à déchiffrer. */}
      <div className={styles.status}>
        {coverage && coverage.count > 0 ? (
          <>
            <span className={styles.metric}>
              <b>{fmtCount(coverage.count)}</b> ticks
            </span>
            <span className={styles.statusDot} aria-hidden="true" />
            <span className={styles.metric}>
              {fmtDateMs(coverage.firstMs)} {fmtClockMs(coverage.firstMs, { millis: false })}
              <span className={styles.arrow} aria-hidden="true">→</span>
              {fmtDateMs(coverage.lastMs)} {fmtClockMs(coverage.lastMs, { millis: false })}
            </span>
            <span className={styles.statusDot} aria-hidden="true" />
            <span className={styles.metric}>
              <b>{coverage.days.length}</b> jour{coverage.days.length > 1 ? 's' : ''}
            </span>

            {!hasMore && rows.length > 0 && (
              <span className={styles.statusNote}>début de l'historique atteint</span>
            )}

            <div className={styles.spacer} />

            <label className={styles.jump}>
              <span>Aller à</span>
              <select value={pinnedDay} onChange={onPickDay}>
                <option value="">Direct — dernières données</option>
                {[...coverage.days].reverse().map(([d, c]) => (
                  <option key={d} value={d}>{fmtDateMs(d)} — {fmtCount(c)} ticks</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <span className={styles.statusNote}>
            {symbolId == null ? 'Aucun symbole' : 'Aucun tick enregistré pour ce symbole'}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Indicateurs ──────────────────────────────────────────────────────────────
// Sortis de la barre et regroupés dans un panneau. Ce sont des réglages qu'on
// pose puis qu'on oublie : les garder en ligne, c'était six contrôles de plus à
// enjamber pour atteindre le seul qu'on touche sans arrêt, le pas de temps.
// Rien n'est caché pour autant — le bouton porte le compte de ce qui est actif,
// et les courbes s'annoncent elles-mêmes sur l'échelle des prix.
function IndicatorMenu({
  isTick,
  smaText, setSmaText, maPeriods,
  showSwings, setShowSwings,
  swingLeft, setSwingLeft, swingRight, setSwingRight,
  showBand, setShowBand, showVolume, setShowVolume,
  showFvg, setShowFvg, showIfvg, setShowIfvg, hideFilled, setHideFilled,
  fvgExt, setFvgExt, fvgLimit, setFvgLimit, fvgCount,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Fermeture au clic extérieur et à Échap : un panneau sans échappatoire
  // devient un piège dès qu'on l'a ouvert par erreur.
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey  = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount = maPeriods.length + (showSwings ? 1 : 0)
    + (showFvg ? 1 : 0) + (showIfvg ? 1 : 0);

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        className={`${styles.menuBtn}${open ? ` ${styles.menuBtnOpen}` : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SlidersIcon />
        Indicateurs
        {activeCount > 0 && <span className={styles.badge}>{activeCount}</span>}
      </button>

      {open && (
        <div className={styles.menu} role="dialog" aria-label="Réglages des indicateurs">
          <section className={styles.menuSection}>
            <h3 className={styles.menuTitle}>Moyennes mobiles</h3>
            <input
              type="text"
              className={styles.textInput}
              value={smaText}
              onChange={e => setSmaText(e.target.value)}
              placeholder="20, 50, 200"
              aria-label="Périodes des moyennes mobiles"
              autoFocus
            />
            <p className={styles.menuHelp}>
              Périodes séparées par des virgules, quatre au plus.
              {isTick && <> Au tick, elles comptent des <strong>ticks</strong>, pas des secondes.</>}
            </p>
            {maPeriods.length > 0 && (
              <ul className={styles.legend}>
                {maPeriods.map((p, i) => (
                  <li key={p}>
                    <i style={{ '--c': MA_COLORS[i % MA_COLORS.length] }} />
                    SMA({p})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.menuSection}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={showSwings}
                onChange={e => setShowSwings(e.target.checked)}
              />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span className={styles.menuTitle}>Swings</span>
            </label>
            <div className={`${styles.swingRow}${showSwings ? '' : ` ${styles.rowOff}`}`}>
              <label className={styles.miniField}>
                <span>gauche</span>
                <input
                  type="number" className={styles.numInput}
                  value={swingLeft} min={1} max={200} disabled={!showSwings}
                  onChange={e => setSwingLeft(clampInt(e.target.value, swingLeft))}
                />
              </label>
              <label className={styles.miniField}>
                <span>droite</span>
                <input
                  type="number" className={styles.numInput}
                  value={swingRight} min={1} max={200} disabled={!showSwings}
                  onChange={e => setSwingRight(clampInt(e.target.value, swingRight))}
                />
              </label>
            </div>
            <p className={styles.menuHelp}>
              {isTick
                ? "Au tick, 5 marque beaucoup — 8 à 15 se lit mieux."
                : "Bougies exigées de chaque côté du pivot."}
            </p>
          </section>

          <section className={styles.menuSection}>
            <div className={styles.titleRow}>
              <h3 className={styles.menuTitle}>Imbalances</h3>
              {!isTick && (showFvg || showIfvg) && (
                <span className={styles.count}>{fvgCount}</span>
              )}
            </div>

            <label className={styles.switch}>
              <input type="checkbox" checked={showFvg} disabled={isTick}
                     onChange={e => setShowFvg(e.target.checked)} />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span className={styles.swatchRow}>
                FVG
                <i style={{ '--c': '#26A69A' }} /><i style={{ '--c': '#EF5350' }} />
              </span>
            </label>

            <label className={styles.switch}>
              <input type="checkbox" checked={showIfvg} disabled={isTick}
                     onChange={e => setShowIfvg(e.target.checked)} />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span className={styles.swatchRow}>
                iFVG
                <i style={{ '--c': '#38BDF8' }} /><i style={{ '--c': '#F59E0B' }} />
              </span>
            </label>

            <label className={`${styles.switch}${showFvg && !isTick ? '' : ` ${styles.rowOff}`}`}>
              <input type="checkbox" checked={hideFilled} disabled={isTick || !showFvg}
                     onChange={e => setHideFilled(e.target.checked)} />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span>Masquer les comblés</span>
            </label>

            <div className={`${styles.swingRow}${isTick || (!showFvg && !showIfvg) ? ` ${styles.rowOff}` : ''}`}>
              <label className={styles.miniField}>
                <span>étirement</span>
                <input
                  type="number" className={styles.numInput}
                  value={fvgExt} min={1} max={500}
                  disabled={isTick || (!showFvg && !showIfvg)}
                  onChange={e => setFvgExt(clampInt(e.target.value, fvgExt, 1, 500))}
                />
                <span>bougies</span>
              </label>
              <label className={styles.miniField}>
                <span title="Motifs gardés, du plus récent au plus ancien. Un motif inversé compte pour un mais dessine deux boîtes.">garder</span>
                <input
                  type="number" className={styles.numInput}
                  value={fvgLimit} min={1} max={60}
                  disabled={isTick || (!showFvg && !showIfvg)}
                  onChange={e => setFvgLimit(clampInt(e.target.value, fvgLimit, 1, 60))}
                />
              </label>
            </div>

            <p className={styles.menuHelp}>
              {isTick
                ? <>Indisponible au tick : un tick n'a pas de mèche, donc pas de trou entre deux. Passer à <strong>1s</strong> ou plus.</>
                : <>Trou laissé entre la mèche de la 1<sup>re</sup> et de la 3<sup>e</sup> bougie. Un FVG traversé en <strong>clôture</strong> devient un iFVG, en pointillés. La zone est coupée net après son étirement. « Garder » compte des <strong>motifs</strong> : un motif inversé en dessine deux.</>}
            </p>
          </section>

          <section className={styles.menuSection}>
            <h3 className={styles.menuTitle}>Affichage</h3>
            {/* Une seule des deux options a un sens à la fois : la bande bid/ask
                n'existe qu'au tick, le volume qu'en bougies. */}
            {isTick ? (
              <label className={styles.switch}>
                <input type="checkbox" checked={showBand} onChange={e => setShowBand(e.target.checked)} />
                <span className={styles.switchTrack} aria-hidden="true"><i /></span>
                <span>Bande bid / ask</span>
              </label>
            ) : (
              <label className={styles.switch}>
                <input type="checkbox" checked={showVolume} onChange={e => setShowVolume(e.target.checked)} />
                <span className={styles.switchTrack} aria-hidden="true"><i /></span>
                <span>Volume (nombre de ticks)</span>
              </label>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SlidersIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </svg>
  );
}

function ZoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" />
      <path d="M2.5 12h19" strokeOpacity="0.45" strokeDasharray="2.5 2.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
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
