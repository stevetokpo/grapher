import styles from './ReplayControls.module.css';

const SPEEDS     = [1, 2, 5, 10, 50, 100];
const STEP_SIZES = [1, 5, 10, 20];

export default function ReplayControls({
  isPlaying, onPlay, onPause,
  onStepBack, onStepForward,
  speed, onSpeedChange,
  stepSize, onStepSizeChange,
  cursor, total,
  currentTime,
  onSeek,
  onTrade,       // callback to open trade modal — presence enables the button
  hasCurrentBar, // true when at least 1 bar is visible
}) {
  const progress   = total > 0 ? (cursor / total) * 100 : 0;
  const atStart    = cursor === 0;
  const atEnd      = cursor >= total;

  return (
    <div className={styles.bar}>
      {/* ── Transport ──────────────────────────────────────────────── */}
      <button
        className={styles.iconBtn}
        onClick={onStepBack}
        disabled={atStart}
        title={`Reculer de ${stepSize} bougie(s)`}
        aria-label={`Reculer de ${stepSize} bougie(s)`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="4" y="4" width="3" height="16" rx="1"/>
          <polygon points="20,4 10,12 20,20"/>
        </svg>
      </button>

      <button
        className={`${styles.playBtn}${isPlaying ? ` ${styles.pauseState}` : ''}`}
        onClick={isPlaying ? onPause : onPlay}
        disabled={atEnd && !isPlaying}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6"  y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        )}
      </button>

      <button
        className={styles.iconBtn}
        onClick={onStepForward}
        disabled={atEnd}
        title={`Avancer de ${stepSize} bougie(s)`}
        aria-label={`Avancer de ${stepSize} bougie(s)`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="4,4 14,12 4,20"/>
          <rect x="17" y="4" width="3" height="16" rx="1"/>
        </svg>
      </button>

      <div className={styles.divider} aria-hidden="true"/>

      {/* ── Trade button ───────────────────────────────────────────── */}
      {onTrade && (
        <button
          className={`${styles.tradeBtn}${isPlaying || !hasCurrentBar ? ` ${styles.tradeBtnOff}` : ''}`}
          onClick={!isPlaying && hasCurrentBar ? onTrade : undefined}
          disabled={isPlaying || !hasCurrentBar}
          title={isPlaying ? 'Mettez en pause pour trader' : 'Passer un trade'}
          aria-label="Passer un trade"
        >
          Trade
        </button>
      )}

      <div className={styles.divider} aria-hidden="true"/>

      {/* ── Step size ──────────────────────────────────────────────── */}
      <div className={styles.controlGroup}>
        <span className={styles.controlLabel}>PAS</span>
        <div className={styles.toggleRow}>
          {STEP_SIZES.map(s => (
            <button
              key={s}
              className={`${styles.toggleBtn}${s === stepSize ? ` ${styles.active}` : ''}`}
              onClick={() => onStepSizeChange(s)}
              aria-pressed={s === stepSize}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.divider} aria-hidden="true"/>

      {/* ── Progress ───────────────────────────────────────────────── */}
      <div className={styles.progressArea}>
        {currentTime && (
          <span className={styles.currentTime}>{currentTime}</span>
        )}
        <div
          className={styles.track}
          onClick={e => {
            const rect = e.currentTarget.getBoundingClientRect();
            onSeek((e.clientX - rect.left) / rect.width);
          }}
          role="slider"
          aria-label="Position dans le replay"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') onSeek(Math.min(1, cursor / Math.max(1, total) + 0.005));
            if (e.key === 'ArrowLeft')  onSeek(Math.max(0, cursor / Math.max(1, total) - 0.005));
          }}
        >
          <div className={styles.trackFill} style={{ width: `${progress}%` }} />
          <div className={styles.thumb}     style={{ left:  `${progress}%` }} />
        </div>
        <span className={styles.barCount}>
          {cursor.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>

      <div className={styles.divider} aria-hidden="true"/>

      {/* ── Speed ──────────────────────────────────────────────────── */}
      <div className={styles.controlGroup}>
        <span className={styles.controlLabel}>VITESSE</span>
        <div className={styles.toggleRow}>
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`${styles.toggleBtn}${s === speed ? ` ${styles.active}` : ''}`}
              onClick={() => onSpeedChange(s)}
              aria-pressed={s === speed}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
