// LE PANNEAU DU LABO — ce qui sépare une corne du reste, en chiffres.
//
// Deux tableaux, et c'est tout ce qu'il faut pour régler un détecteur :
//   • la COMPARAISON met côte à côte la médiane de chaque mesure chez les
//     exemples marqués « corne », chez les contre-exemples, et chez TOUTES les
//     pointes du graphe. Une mesure dont les trois colonnes se ressemblent ne
//     reconnaît rien — c'est là qu'on voit quels rapports méritent un seuil.
//   • la LISTE des échantillons, cliquable pour retrouver la pointe sur le
//     graphe et vérifier de ses yeux ce que la mesure a compris.

import { useMemo, useState } from 'react';
import { describe } from '../../lib/rsi/features';
import styles from './HornPanel.module.css';

// Les mesures affichées, dans l'ordre de lecture du motif.
const ROWS = [
  { key: 'riseBars',     label: 'montée (bougies)' },
  { key: 'riseAmp',      label: 'montée (pts RSI)' },
  { key: 'riseEff',      label: 'régularité montée' },
  { key: 'dropBars',     label: 'chute (bougies)' },
  { key: 'dropAmp',      label: 'chute (pts RSI)' },
  { key: 'dropEff',      label: 'régularité chute' },
  { key: 'sharpness',    label: 'pointe (× pente)' },
  { key: 'timeRatio',    label: 'durée montée/chute' },
  { key: 'rewindBars',   label: 'rembobinage (bougies)' },
  { key: 'rewindPerBar', label: 'rembobinage / bougie' },
  { key: 'retrace',      label: 'retour de la montée' },
  { key: 'firstShare',   label: 'part de la 1re bougie' },
  { key: 'tipFlat',      label: 'plateau au sommet' },
  { key: 'level',        label: 'niveau du sommet' },
];

const MONTHS = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
function fmtDate(t) {
  const d = new Date(t * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

export default function HornPanel({ samples, horns, busy, onFocus, onDelete, onClose }) {
  const [tab, setTab] = useState('compare');

  const oui = useMemo(() => samples.filter(s => s.label === 'oui'), [samples]);
  const non = useMemo(() => samples.filter(s => s.label === 'non'), [samples]);

  const statsOui = useMemo(() => describe(oui.map(s => s.features)), [oui]);
  const statsNon = useMemo(() => describe(non.map(s => s.features)), [non]);
  const statsAll = useMemo(() => describe(horns ?? []), [horns]);

  return (
    <aside className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.title}>LABO DE LA CORNE</div>
        <button className={styles.close} onClick={onClose} aria-label="Fermer le panneau">×</button>
      </header>

      <div className={styles.counts}>
        <span className={styles.pillOui}>{oui.length} corne{oui.length > 1 ? 's' : ''}</span>
        <span className={styles.pillNon}>{non.length} contre-ex.</span>
        <span className={styles.pillAll}>{horns?.length ?? 0} pointes vues</span>
        {busy && <span className={styles.busy}>…</span>}
      </div>

      <div className={styles.tabs} role="tablist">
        <button
          className={`${styles.tab}${tab === 'compare' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('compare')} role="tab" aria-selected={tab === 'compare'}
        >Comparaison</button>
        <button
          className={`${styles.tab}${tab === 'list' ? ` ${styles.tabActive}` : ''}`}
          onClick={() => setTab('list')} role="tab" aria-selected={tab === 'list'}
        >Échantillons</button>
      </div>

      {tab === 'compare' ? (
        <div className={styles.body}>
          {oui.length === 0 && (
            <p className={styles.hint}>
              Passe en mode <b>Marquer</b> et clique sur les pointes qui sont des cornes.
              Marque aussi des <b>contre-exemples</b> : sans eux, impossible de savoir
              quel rapport sépare vraiment le motif du reste.
            </p>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thL}>mesure (médiane)</th>
                <th className={styles.thOui}>corne</th>
                <th className={styles.thNon}>non</th>
                <th className={styles.thAll}>toutes</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(({ key, label }) => {
                const a = statsOui[key], b = statsNon[key], c = statsAll[key];
                return (
                  <tr key={key} className={separates(a, b, c) ? styles.rowStrong : ''}>
                    <td className={styles.tdL}>{label}</td>
                    <td className={styles.tdOui}>{fmt(a?.med)}</td>
                    <td className={styles.tdNon}>{fmt(b?.med)}</td>
                    <td className={styles.tdAll}>{fmt(c?.med)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {oui.length > 0 && (
            <p className={styles.legend}>
              Les lignes en clair sont celles où la médiane des cornes s’écarte
              nettement de la médiane des autres pointes — les candidates au seuil.
              Étendue complète (p10 / p90) dans <code>data/rsi-samples.json</code>.
            </p>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          {samples.length === 0 && <p className={styles.hint}>Aucun échantillon marqué.</p>}
          <ul className={styles.list}>
            {[...samples].reverse().map(s => (
              <li key={s.id} className={styles.item}>
                <button className={styles.itemMain} onClick={() => onFocus(s)}>
                  <div className={styles.itemTop}>
                    <span className={s.label === 'oui' ? styles.dotOui : styles.dotNon} />
                    <span className={styles.itemDate}>{fmtDate(s.time)}</span>
                    <span className={styles.itemSide}>{s.side === 'bear' ? '▼' : '▲'}</span>
                  </div>
                  <div className={styles.itemStats}>
                    <span>{s.features.riseBars}b ↗</span>
                    <span>{s.features.dropBars}b ↘</span>
                    <span>×{fmt(s.features.sharpness)}</span>
                    <span>{s.features.rewindBars}b ⟲</span>
                  </div>
                  {s.note && <div className={styles.itemNote}>{s.note}</div>}
                </button>
                <button
                  className={styles.del}
                  onClick={() => onDelete(s)}
                  aria-label="Supprimer l’échantillon"
                >×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function fmt(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
}

// Une mesure « sépare » si la médiane des cornes s'écarte d'au moins 40 % de
// celle des autres pointes. Grossier — c'est un repère visuel pour l'œil, pas
// un test ; le vrai tri se fait dans scripts/rsi-lab.mjs.
function separates(oui, non, all) {
  const ref = non?.n ? non.med : all?.med;
  if (oui?.med == null || ref == null) return false;
  const base = Math.max(Math.abs(ref), 0.5);
  return Math.abs(oui.med - ref) / base >= 0.4;
}
