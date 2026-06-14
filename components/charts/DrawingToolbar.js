import { useState, useEffect } from 'react';
import styles from './DrawingToolbar.module.css';

const Ico = ({ children }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

// ── All icons ─────────────────────────────────────────────────────────────
const ICONS = {
  cursor:    <Ico><path d="M5 3l14 9-7 1-4 7z" fill="currentColor" stroke="none"/></Ico>,
  // Lignes
  segment:   <Ico><line x1="4" y1="20" x2="20" y2="4"/></Ico>,
  ray:       <Ico><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2.5" fill="currentColor" stroke="none"/></Ico>,
  trendline: <Ico><line x1="2" y1="22" x2="22" y2="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></Ico>,
  hline:     <Ico><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></Ico>,
  vline:     <Ico><line x1="12" y1="2" x2="12" y2="22"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></Ico>,
  crossline: <Ico><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></Ico>,
  arrow:     <Ico><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></Ico>,
  ruler:     <Ico><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="20" x2="4" y2="13"/><line x1="20" y1="4" x2="20" y2="11"/></Ico>,
  // Canaux
  channel_parallel:   <Ico><line x1="3" y1="18" x2="21" y2="6"/><line x1="3" y1="14" x2="21" y2="2"/></Ico>,
  channel_flat:       <Ico><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="22" y2="16"/></Ico>,
  channel_regression: <Ico><line x1="3" y1="19" x2="21" y2="5"/><line x1="3" y1="14" x2="21" y2="14" strokeDasharray="2 2" strokeOpacity="0.6"/><line x1="3" y1="10" x2="21" y2="10" strokeDasharray="2 2" strokeOpacity="0.6"/></Ico>,
  channel_raff:       <Ico><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6"  x2="21" y2="6"  strokeDasharray="2 2" strokeOpacity="0.6"/><line x1="3" y1="18" x2="21" y2="18" strokeDasharray="2 2" strokeOpacity="0.6"/></Ico>,
  channel_disjoint:   <Ico><line x1="3" y1="18" x2="12" y2="6"/><line x1="12" y1="18" x2="21" y2="6" strokeOpacity="0.5"/></Ico>,
  // Formes
  rect:      <Ico><rect x="4" y="6" width="16" height="12" rx="1"/></Ico>,
  ellipse:   <Ico><ellipse cx="12" cy="12" rx="9" ry="6"/></Ico>,
  triangle:  <Ico><polygon points="12 4 22 20 2 20"/></Ico>,
  path:      <Ico><polyline points="3 18 8 9 13 15 18 7"/></Ico>,
  highlight: <Ico><line x1="2" y1="8" x2="22" y2="8"/><rect x="2" y="8" width="20" height="8" stroke="none" fill="currentColor" fillOpacity="0.3"/><line x1="2" y1="16" x2="22" y2="16"/></Ico>,
  // UI
  trash: <Ico><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></Ico>,
};

// ── Tool groups ───────────────────────────────────────────────────────────
const GROUPS = [
  {
    key:   'lignes',
    label: 'Lignes',
    icon:  ICONS.segment,
    items: [
      { id: 'segment',   label: 'Segment',              key: 'segment'   },
      { id: 'ray',       label: 'Demi-droite',           key: 'ray'       },
      { id: 'trendline', label: 'Droite de tendance',    key: 'trendline' },
      { id: 'hline',     label: 'Ligne horizontale',     key: 'hline'     },
      { id: 'vline',     label: 'Ligne verticale',       key: 'vline'     },
      { id: 'crossline', label: 'Ligne croisée',         key: 'crossline' },
      { id: 'arrow',     label: 'Flèche directionnelle', key: 'arrow'     },
      { id: 'ruler',     label: 'Règle (mesure)',         key: 'ruler'     },
    ],
  },
  {
    key:   'canaux',
    label: 'Canaux',
    icon:  ICONS.channel_parallel,
    items: [
      { id: 'channel_parallel',   label: 'Canal parallèle',     key: 'channel_parallel'   },
      { id: 'channel_flat',       label: 'Canal plat',          key: 'channel_flat'       },
      { id: 'channel_regression', label: 'Canal de régression', key: 'channel_regression' },
      { id: 'channel_raff',       label: 'Canal de Raff',       key: 'channel_raff'       },
      { id: 'channel_disjoint',   label: 'Canal disjoint',      key: 'channel_disjoint'   },
    ],
  },
  {
    key:   'formes',
    label: 'Formes',
    icon:  ICONS.rect,
    items: [
      { id: 'rect',      label: 'Rectangle',             key: 'rect'      },
      { id: 'ellipse',   label: 'Ellipse / Cercle',      key: 'ellipse'   },
      { id: 'triangle',  label: 'Triangle',              key: 'triangle'  },
      { id: 'path',      label: 'Chemin (polyline)',     key: 'path'      },
      { id: 'highlight', label: 'Zone mise en évidence', key: 'highlight' },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────
export default function DrawingToolbar({ activeTool, onToolChange, onClearAll }) {
  const [openGroup, setOpenGroup] = useState(null);

  // Auto-open the group that contains the active tool
  useEffect(() => {
    if (!activeTool) return;
    const grp = GROUPS.find(g => g.items.some(t => t.id === activeTool));
    if (grp) setOpenGroup(grp.key);
  }, [activeTool]);

  const toggle = (key) => setOpenGroup(prev => prev === key ? null : key);

  return (
    <div className={styles.toolbar}>
      {/* ── Cursor ────────────────────────────────────────────────── */}
      <button
        title="Curseur (sélection)"
        className={`${styles.btn} ${activeTool === null ? styles.active : ''}`}
        onClick={() => onToolChange(null)}
      >
        {ICONS.cursor}
      </button>

      <div className={styles.divider} />

      {/* ── Tool groups ───────────────────────────────────────────── */}
      {GROUPS.map(group => {
        const isOpen      = openGroup === group.key;
        const hasActive   = group.items.some(t => t.id === activeTool);
        return (
          <div key={group.key}>
            <button
              title={group.label}
              className={[
                styles.groupTrigger,
                isOpen    ? styles.open      : '',
                hasActive ? styles.hasActive : '',
              ].filter(Boolean).join(' ')}
              onClick={() => toggle(group.key)}
            >
              {group.icon}
            </button>

            {isOpen && (
              <div className={styles.toolGrid}>
                {group.items.map(t => (
                  <button
                    key={t.key}
                    title={t.label}
                    className={`${styles.btn} ${activeTool === t.id ? styles.active : ''}`}
                    onClick={() => onToolChange(activeTool === t.id ? null : t.id)}
                  >
                    {ICONS[t.key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className={styles.divider} />

      {/* ── Clear all ─────────────────────────────────────────────── */}
      <button
        title="Effacer tous les objets"
        className={styles.clearBtn}
        onClick={onClearAll}
      >
        {ICONS.trash}
      </button>
    </div>
  );
}
