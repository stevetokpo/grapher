import { useState, useEffect, useRef } from 'react';
import styles from './DrawingToolbar.module.css';

const Ico = ({ children }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const ICONS = {
  cursor:             <Ico><path d="M5 3l14 9-7 1-4 7z" fill="currentColor" stroke="none"/></Ico>,
  // Lignes
  segment:            <Ico><line x1="4" y1="20" x2="20" y2="4"/></Ico>,
  ray:                <Ico><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="2.5" fill="currentColor" stroke="none"/></Ico>,
  trendline:          <Ico><line x1="2" y1="22" x2="22" y2="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></Ico>,
  hline:              <Ico><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></Ico>,
  vline:              <Ico><line x1="12" y1="2" x2="12" y2="22"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/></Ico>,
  crossline:          <Ico><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></Ico>,
  arrow:              <Ico><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></Ico>,
  ruler:              <Ico><line x1="4" y1="20" x2="20" y2="4"/><line x1="4" y1="20" x2="4" y2="13"/><line x1="20" y1="4" x2="20" y2="11"/></Ico>,
  // Canaux
  channel_parallel:   <Ico><line x1="3" y1="18" x2="21" y2="6"/><line x1="3" y1="14" x2="21" y2="2"/></Ico>,
  channel_flat:       <Ico><line x1="2" y1="8" x2="22" y2="8"/><line x1="2" y1="16" x2="22" y2="16"/></Ico>,
  channel_regression: <Ico><line x1="3" y1="19" x2="21" y2="5"/><line x1="3" y1="14" x2="21" y2="14" strokeDasharray="2 2" strokeOpacity="0.6"/><line x1="3" y1="10" x2="21" y2="10" strokeDasharray="2 2" strokeOpacity="0.6"/></Ico>,
  channel_raff:       <Ico><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6"  x2="21" y2="6"  strokeDasharray="2 2" strokeOpacity="0.6"/><line x1="3" y1="18" x2="21" y2="18" strokeDasharray="2 2" strokeOpacity="0.6"/></Ico>,
  channel_disjoint:   <Ico><line x1="3" y1="18" x2="12" y2="6"/><line x1="12" y1="18" x2="21" y2="6" strokeOpacity="0.5"/></Ico>,
  // Formes
  rect:               <Ico><rect x="4" y="6" width="16" height="12" rx="1"/></Ico>,
  ellipse:            <Ico><ellipse cx="12" cy="12" rx="9" ry="6"/></Ico>,
  triangle:           <Ico><polygon points="12 4 22 20 2 20"/></Ico>,
  path:               <Ico><polyline points="3 18 8 9 13 15 18 7"/></Ico>,
  highlight:          <Ico><line x1="2" y1="8" x2="22" y2="8"/><rect x="2" y="8" width="20" height="8" stroke="none" fill="currentColor" fillOpacity="0.3"/><line x1="2" y1="16" x2="22" y2="16"/></Ico>,
  // Prévisions
  position_long:  (
    <Ico>
      <rect x="3" y="3" width="18" height="8" fill="#26A69A" fillOpacity="0.4" stroke="none"/>
      <rect x="3" y="13" width="18" height="8" fill="#EF5350" fillOpacity="0.4" stroke="none"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
    </Ico>
  ),
  position_short: (
    <Ico>
      <rect x="3" y="3" width="18" height="8" fill="#EF5350" fillOpacity="0.4" stroke="none"/>
      <rect x="3" y="13" width="18" height="8" fill="#26A69A" fillOpacity="0.4" stroke="none"/>
      <line x1="3" y1="13" x2="21" y2="13"/>
    </Ico>
  ),
  // Mesureurs
  price_range:    <Ico><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="17" x2="21" y2="17"/><line x1="12" y1="7" x2="12" y2="17" strokeDasharray="2 2" strokeOpacity="0.5"/></Ico>,
  date_range:     <Ico><line x1="7" y1="3" x2="7" y2="21"/><line x1="17" y1="3" x2="17" y2="21"/><line x1="7" y1="12" x2="17" y2="12" strokeDasharray="2 2" strokeOpacity="0.5"/></Ico>,
  datetime_range: <Ico><rect x="4" y="5" width="16" height="14" rx="1"/><line x1="12" y1="5" x2="12" y2="19" strokeDasharray="2 2" strokeOpacity="0.5"/><line x1="4" y1="12" x2="20" y2="12" strokeDasharray="2 2" strokeOpacity="0.5"/></Ico>,
  // UI
  trash:              <Ico><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></Ico>,
};

const GROUPS = [
  {
    key:         'lines',
    label:       'Lignes',
    defaultIcon: 'segment',
    items: [
      { id: 'segment',   label: 'Segment'              },
      { id: 'ray',       label: 'Demi-droite'           },
      { id: 'trendline', label: 'Droite de tendance'    },
      { id: 'hline',     label: 'Horizontale'           },
      { id: 'vline',     label: 'Verticale'             },
      { id: 'crossline', label: 'Ligne croisée'         },
      { id: 'arrow',     label: 'Flèche'               },
      { id: 'ruler',     label: 'Règle (mesure)'        },
    ],
  },
  {
    key:         'channels',
    label:       'Canaux',
    defaultIcon: 'channel_parallel',
    items: [
      { id: 'channel_parallel',   label: 'Canal parallèle'     },
      { id: 'channel_flat',       label: 'Canal plat'          },
      { id: 'channel_regression', label: 'Régression linéaire' },
      { id: 'channel_raff',       label: 'Canal de Raff'       },
      { id: 'channel_disjoint',   label: 'Canal disjoint'      },
    ],
  },
  {
    key:         'shapes',
    label:       'Formes',
    defaultIcon: 'rect',
    items: [
      { id: 'rect',      label: 'Rectangle'            },
      { id: 'ellipse',   label: 'Ellipse'              },
      { id: 'triangle',  label: 'Triangle'             },
      { id: 'path',      label: 'Tracé libre'          },
      { id: 'highlight', label: 'Zone mise en avant'   },
    ],
  },
  {
    key:         'positions',
    label:       'Prévisions',
    defaultIcon: 'position_long',
    items: [
      { id: 'position_long',  label: 'Position longue'  },
      { id: 'position_short', label: 'Position courte'  },
    ],
  },
  {
    key:         'measures',
    label:       'Mesureurs',
    defaultIcon: 'price_range',
    items: [
      { id: 'price_range',    label: 'Plage de prix'          },
      { id: 'date_range',     label: 'Plage de dates'         },
      { id: 'datetime_range', label: 'Plage de date et prix'  },
    ],
  },
];

export default function DrawingToolbar({ activeTool, onToolChange, onClearAll }) {
  const [openGroup, setOpenGroup]   = useState(null);
  const [lastInGroup, setLastInGroup] = useState({});
  const toolbarRef = useRef(null);

  // Close flyout on outside click
  useEffect(() => {
    if (!openGroup) return;
    const handler = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [openGroup]);

  // Close flyout when drawing mode exits
  useEffect(() => {
    if (activeTool === null) setOpenGroup(null);
  }, [activeTool]);

  const selectTool = (toolId, groupKey) => {
    onToolChange(activeTool === toolId ? null : toolId);
    setLastInGroup(prev => ({ ...prev, [groupKey]: toolId }));
    setOpenGroup(null);
  };

  const toggleGroup = (groupKey) => {
    setOpenGroup(prev => prev === groupKey ? null : groupKey);
  };

  return (
    <div className={styles.toolbar} ref={toolbarRef}>
      {/* Cursor */}
      <button
        title="Curseur — sélection (Echap)"
        className={`${styles.btn} ${activeTool === null ? styles.active : ''}`}
        onClick={() => onToolChange(null)}
      >
        {ICONS.cursor}
      </button>

      <div className={styles.divider} />

      {/* Groups with flyout */}
      {GROUPS.map(group => {
        const isOpen    = openGroup === group.key;
        const hasActive = group.items.some(i => i.id === activeTool);
        const iconId    = hasActive
          ? activeTool
          : (lastInGroup[group.key] ?? group.defaultIcon);

        return (
          <div key={group.key} className={styles.group}>
            <button
              title={group.label}
              className={[
                styles.groupBtn,
                hasActive ? styles.hasActive : '',
                isOpen    ? styles.open      : '',
              ].filter(Boolean).join(' ')}
              onClick={() => toggleGroup(group.key)}
            >
              {ICONS[iconId]}
            </button>

            {isOpen && (
              <div className={styles.flyout}>
                <div className={styles.flyoutTitle}>{group.label}</div>
                {group.items.map(item => (
                  <button
                    key={item.id}
                    className={[
                      styles.flyoutItem,
                      activeTool === item.id ? styles.flyoutActive : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => selectTool(item.id, group.key)}
                  >
                    <span className={styles.flyoutIcon}>{ICONS[item.id]}</span>
                    <span className={styles.flyoutLabel}>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className={styles.divider} />

      {/* Clear all */}
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
