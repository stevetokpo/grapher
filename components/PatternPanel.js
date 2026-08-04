import { useState, useEffect } from 'react';
import styles from './PatternPanel.module.css';
import { XFVG_DEFAULTS, FIELDS as XFVG_FIELDS } from '../lib/xfvg/params';
import { XFVGX_DEFAULTS, FIELDS as XFVGX_FIELDS } from '../lib/xfvgx/params';
import { LIQ_DEFAULTS,  FIELDS as LIQ_FIELDS  } from '../lib/liq/params';
import { REV_DEFAULTS,  FIELDS as REV_FIELDS  } from '../lib/rev/params';
import { RINGBLE_DEFAULTS, FIELDS as RINGBLE_FIELDS } from '../lib/ringble/params';
import { SUPER_AVAL_DEFAULTS, FIELDS as SUPER_AVAL_FIELDS } from '../lib/superAval/params';
import { RSIER_DEFAULTS, FIELDS as RSIER_FIELDS } from '../lib/rsier/params';
import { TRENDER_DEFAULTS, FIELDS as TRENDER_FIELDS } from '../lib/trender/params';
import { TWINS_DEFAULTS, FIELDS as TWINS_FIELDS } from '../lib/twins/params';

const COLORS = [
  '#26A69A', '#EF5350', '#60A5FA', '#F59E0B',
  '#A78BFA', '#F472B6', '#34D399', '#FB923C',
  // Bleu marine et rouge franc — les couleurs par défaut des niveaux liq. Sans
  // elles dans la palette, cliquer une pastille par curiosité rendrait le
  // réglage d'origine irrécupérable.
  '#2B4FD8', '#E53935',
];

// Add an entry here each time a new pattern is implemented.
export const PATTERN_TYPES = [
  {
    // Twins Bars — deux bougies COLLÉES et de sens opposés, à corps plein et de
    // taille voisine. Le sens du signal est celui de la seconde. Détection,
    // réglages et positions dans lib/twins/ ; ce bloc ne porte que l'identité.
    // L'entrée est AU MARCHÉ et seulement là : le motif est un repère, pas une
    // zone où poser un ordre en attente.
    type:   'TWINS_BARS',
    label:  'Twins Bars',
    desc:   'Deux bougies opposées à corps plein, de taille similaire et large vs ATR',
    color:  '#A78BFA',
    ...TWINS_DEFAULTS,
  },
  {
    type:          'FVG',
    label:         'FVG / iFVG',
    desc:          "Fair Value Gap — zones d'imbalance (3 bougies)",
    color:         '#60A5FA',
    render:        'zone',
    direction:     'both',
    bullColor:     '#26A69A',
    bearColor:     '#EF5350',
    opacity:       0.18,
    showMitigated: true,
    showInverse:   true,
    showLabel:     true,
    maxLen:        0,
    // Filtres portés de pines/trender.pine (désactivés par défaut)
    minPts:        0,
    atrPeriod:     14,
    atrMin:        0,
    atrMax:        0,
  },
  {
    type:      'RFVG',
    label:     'rFVG / aFVG',
    desc:      'Gap laissé par une bougie large — à contre-courant de la MM50 (rFVG), ou partout (aFVG)',
    color:     '#FB923C',
    render:    'zone',
    mode:      'rfvg',
    direction: 'both',
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showLabel: true,
    minPts:       0,
    maxPts:       0,   // hauteur max de la zone, en points (0 = pas de plafond)
    maPeriodFast: 15,
    maPeriodSlow: 200,
    slowOpenOnly: false,
    firstSlowSide: false,
    slowStraddle:  false,
    pairOpposite:  false,
    atrPeriod: 14,
    atrMult:   1.5,
    atrMult3:  0,
    wick3:     false,
    sizeMode:  'range',
    extLen:    20,
    // Mode « position » : entrée marché à l'ouverture de B4, stop structurel
    // sous/sur l'extrême B3-B4 (marge en points), TP en points
    display:      'zone',
    slMarginPts:   2,
    slCapPts:      0,
    spreadPts:     0,
    tpPts:         10,
    beTriggerPts:  0,
    beTouchTrigger: 0,
    beBarsTrigger: 0,
    beSwingBars:   0,
    beLevelPts:    0,
    uniqueTrade:   false,
    skipAfterTp:   0,
    // Le dû — même règle que le Twins Bars, même fichier (lib/dueLedger.js).
    // 0 = éteint : le motif joue son vrai TP et ne rembourse rien.
    dueAfterSl:    0,
    dueMode:       'full',
  },
  {
    // xFVG — deux figures sous un même interrupteur, choisies par le réglage
    // `mode` : l'imbalance 3 bougies (le motif nu de la famille rFVG) ou le
    // retournement contra-MM en 2 bougies. Ni sous-familles (rFVG / superFVG),
    // ni mode « position » : une zone, dans les deux cas.
    // Ses réglages et son formulaire vivent dans lib/xfvg/params.js — c'est là
    // qu'on ajoute une condition, pas ici. Ce bloc ne porte que l'identité.
    type:   'XFVG',
    label:  'xFVG',
    desc:   'Imbalance 3 bougies, ou retournement contra-MM en 2 bougies — au choix',
    color:  '#38BDF8',
    render: 'zone',
    ...XFVG_DEFAULTS,
  },
  {
    // xFVG+ — le xFVG EXTRA, sorti en pattern à lui : la boîte contient le
    // dernier swing d'en face, et c'est ce prix-là qu'on attend. Même détecteur
    // que le xFVG (calcXFVG, `swing` forcé sur 'extra' dans lib/xfvgx/detect.js) ;
    // ce que ce pattern ajoute, l'autre ne l'a pas : un ordre en attente sur le
    // trait, SL et TP fixes en points, un moniteur et un rapport.
    // Ses réglages vivent dans lib/xfvgx/params.js — c'est là qu'on ajoute un
    // réglage, pas ici. Ce bloc ne porte que l'identité.
    type:   'XFVGX',
    label:  'xFVG+',
    desc:   'xFVG dont la zone contient le swing cassé — entrée au retour sur ce trait',
    color:  '#E879F9',
    render: 'zone',
    ...XFVGX_DEFAULTS,
  },
  {
    // liq — la pince : deux impulsions opposées séparées par une respiration,
    // SANS gap à trouver. Née dans le xFVG, sortie en pattern autonome parce
    // qu'elle ne cherche aucun déséquilibre : ce n'est plus la même famille.
    // Réglages et formulaire dans lib/liq/params.js.
    type:   'LIQ',
    label:  'liq',
    desc:   'Deux impulsions opposées séparées par une respiration — sans imbalance',
    color:  '#A78BFA',
    render: 'zone',
    ...LIQ_DEFAULTS,
  },
  {
    // rev — pause, puis retournement en DEUX impulsions opposées et collées. Même
    // famille que liq (retournement, gestion partagée), mais la respiration est
    // AVANT les impulsions au lieu d'être entre elles.
    type:   'REV',
    label:  'rev',
    desc:   'Une pause, puis deux impulsions opposées — le sens est celui de la seconde',
    color:  '#34D399',
    render: 'zone',
    ...REV_DEFAULTS,
  },
  {
    // ringble — DEUX bougies collées et de sens opposés : HB (haussière puis
    // baissière) ou BH (baissière puis haussière). La SECONDE porte tout — le
    // sens comme les conditions ; la première n'est là que comme mesure.
    // Motif en cours d'écriture : pas de zone, pas de position, un repère et
    // c'est tout. Ses réglages vivent dans lib/ringble/params.js — c'est là
    // qu'on ajoute une condition, pas ici. Ce bloc ne porte que l'identité.
    type:   'RINGBLE',
    label:  'ringble',
    desc:   'Deux bougies opposées — la 2e ni plus petite ni beaucoup plus grande que la 1e, et à corps plein',
    color:  '#F472B6',
    ...RINGBLE_DEFAULTS,
  },
  {
    // super avalante — UNE bougie qui en avale plusieurs d'un coup : elle est
    // précédée d'une bougie de sens opposé, et les N bougies encore DERRIÈRE
    // celle-ci tiennent entièrement entre son plus haut et son plus bas. La
    // bougie opposée, elle, a le droit de dépasser — c'est ce qui la distingue
    // d'une avalante classique. Un repère, pas de zone ni de position. Ses
    // réglages vivent dans lib/superAval/params.js — c'est là qu'on ajoute une
    // condition, pas ici. Ce bloc ne porte que l'identité.
    type:   'SUPER_AVAL',
    label:  'super avalante',
    desc:   'Une bougie qui avale entièrement les N bougies situées derrière la bougie opposée',
    color:  '#22D3EE',
    ...SUPER_AVAL_DEFAULTS,
  },
  {
    // RSIER — les surzones du RSI d'une unité de temps SUPÉRIEURE, marquées sur
    // le graphe comme le TRENDER marque ses zones d'harmonie : une bande
    // verticale, pas une boîte de prix. Non-repaint : chaque bougie du graphe lit
    // le RSI de la dernière bougie HTF CLÔTURÉE. Ses réglages vivent dans
    // lib/rsier/params.js — c'est là qu'on ajoute une condition, pas ici. Ce
    // bloc ne porte que l'identité.
    type:   'RSIER',
    label:  'RSIER',
    desc:   'Le RSI d’une unité de temps supérieure en surachat / survente — marqué en zone',
    color:  '#F59E0B',
    render: 'zone',
    ...RSIER_DEFAULTS,
  },
  {
    // TRENDER — la logique de l'INDICATEUR du même nom, à l'identique : c'est la
    // même fonction (lib/harmony.js) qui calcule les deux, appelée ici via
    // lib/trender/detect.js. Ce que le motif ajoute, l'indicateur ne l'a pas :
    // un filtre de sens, et surtout la position, sa gestion et son rapport.
    // Le type est 'HARMONY' et non 'TRENDER' pour qu'aucun code ne confonde un
    // MOTIF avec l'INDICATEUR, qui porte déjà ce type dans son propre registre —
    // l'étiquette, elle, dit bien TRENDER, c'est le même objet à l'écran.
    // Ses réglages vivent dans lib/trender/params.js ; ce bloc ne porte que
    // l'identité.
    type:   'HARMONY',
    label:  'TRENDER',
    desc:   'Harmonie multi-HTF — la zone s’ouvre quand tous les HTF pointent dans le même sens',
    color:  '#34D399',
    render: 'zone',
    ...TRENDER_DEFAULTS,
  },
  {
    // KO — la sœur du rFVG en DEUX bougies : même famille (impulsion à
    // contre-courant des deux MM, entrée au marché sur la bougie suivante, stop
    // structurel), mais le motif se lit dans la FORME des bougies et non dans un
    // gap. Ces défauts sont ceux de lib/ko/pattern.js : les changer ici ferait
    // mentir le graphe par rapport à la page /ko.
    type:      'KO',
    label:     'KO',
    desc:      'Impulsion pleine à contre-courant des 2 MM, suivie d’une bougie indécise',
    color:     '#A78BFA',
    render:    'zone',
    direction: 'both',
    maPeriodFast: 15,
    maPeriodSlow: 200,
    atrPeriod:  14,
    atrMult1:   1.3,
    bodyRatio1: 0.9,
    atrMult2:   0.3,
    bodyRatio2: 0.3,
    extLen:     20,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showLabel: true,
    // Mode « position » : entrée marché à l'ouverture de la 3e bougie, stop
    // structurel sous/sur l'extrême B2-B3 (marge en points), TP en points.
    display:        'zone',
    slMarginPts:     2,
    slCapPts:        0,
    spreadPts:       0,
    tpPts:           10,
    beTriggerPts:    0,
    beTouchTrigger:  0,
    beBarsTrigger:   0,
    beSwingBars:     0,
    beLevelPts:      0,
    maxBars:         0,
    uniqueTrade:     false,
    skipAfterTp:     0,
  },
  {
    type:      'HBH_BHB',
    label:     'HBH / BHB',
    desc:      '3 bougies : 1e & 3e englobent toute la 2e (mèches incl.)',
    color:     '#F59E0B',
    render:    'zone',
    direction: 'both',
    engMult:   1.5,
    extLen:    20,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showMid:   true,
    showLabel: true,
  },
  {
    type:      'HBHB_BHBH',
    label:     'HBHB / BHBH',
    desc:      '4 bougies groupées alternées : corps 1 & 3 ≥ bodyMult × corps 2, 4e clôture sous/sur ouverture 2e',
    color:     '#F472B6',
    render:    'zone',
    direction: 'both',
    bodyMult:  1.5,
    extLen:    20,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    opacity:   0.18,
    showLabel: true,
  },
  {
    type:          'COMPRESSION',
    label:         'Compression',
    desc:          'ATR plat puis expansion brusque (contraction de volatilité)',
    color:         '#34D399',
    render:        'zone',
    mode:          'atr',
    // méthode ATR plat
    atrPeriod:     14,
    flatTol:       0.12,
    breakMult:     1.8,
    // méthode squeeze TTM
    length:        20,
    bbMult:        2,
    kcMult:        1.5,
    // commun
    minLength:     6,
    extendToBreak: true,
    upColor:       '#26A69A',
    downColor:     '#EF5350',
    neutralColor:  '#64748B',
    opacity:       0.18,
    showArrow:     true,
    showLabel:     true,
  },
  {
    type:      'HMBM',
    label:     'HM / BM',
    desc:      'Grosse bougie à contre-courant de la MM75 (≥ ATR) suivie d’une petite — entrée + SL',
    color:     '#22D3EE',
    render:    'zone',
    direction: 'both',
    maPeriod:  75,
    atrPeriod: 14,
    mult1:     1,
    mult2:     0.5,
    extLen:    5,
    bullColor: '#26A69A',
    bearColor: '#EF5350',
    slColor:   '#B22222',
    // Mode « position » : entrée marché à l'ouverture de X, SL = extrême M–X, TP en points
    display:   'levels',
    tpPts:     10,
    spreadPts: 0,
  },
];

export const DEFAULT_PATTERNS = PATTERN_TYPES.map(p => ({ ...p, enabled: true }));

// ── Shared sub-components ─────────────────────────────────────────────────────

function NumInput({ value, min, max, step = 1, onChange }) {
  const [str, setStr] = useState(String(value));
  useEffect(() => { setStr(String(value)); }, [value]);

  const commit = raw => {
    const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
    const c = isNaN(n) ? min : Math.max(min, Math.min(max, n));
    setStr(String(c));
    onChange(c);
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
        const n = step < 1 ? parseFloat(raw) : parseInt(raw, 10);
        if (!isNaN(n) && n >= min && n <= max) onChange(n);
      }}
      onBlur={e => commit(e.target.value)}
    />
  );
}

function Swatches({ value, onChange: onCh }) {
  return (
    <div className={styles.colorRow}>
      {COLORS.map(c => (
        <button
          key={c}
          className={`${styles.swatch}${value === c ? ` ${styles.swatchActive}` : ''}`}
          style={{ '--sw': c }}
          onClick={() => onCh(c)}
          aria-pressed={value === c}
          aria-label={`Couleur ${c}`}
        />
      ))}
    </div>
  );
}

// ── Formulaire décrit par schéma ──────────────────────────────────────────────
//
// Les motifs historiques écrivent leur formulaire à la main, un bloc JSX par
// motif — d'où les 250 lignes du rFVG, où ajouter un réglage veut dire recopier
// un champ de plus. Les motifs récents (xFVG) décrivent plutôt leurs champs
// dans leur module de réglages, et c'est ce composant qui les dessine. Rien
// n'oblige à convertir les anciens : les deux cohabitent.
//
// Un champ : { kind, key, label, ...options } — cf. lib/xfvg/params.js.

function SchemaField({ field, form, defaults, setF }) {
  const { kind, key, label } = field;

  // `when` juge sur les réglages EFFECTIFS (formulaire par-dessus les défauts),
  // pas sur le seul formulaire : un motif enregistré avant l'ajout d'un réglage
  // n'en a pas la clé, et le champ resterait masqué à tort.
  if (field.when && !field.when({ ...defaults, ...form })) return null;

  if (kind === 'divider') return <div className={styles.sectionDivider}>{label}</div>;
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
      <span className={styles.label} style={field.tint ? { color: field.tint } : undefined}>
        {label}
      </span>

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
          {value === true ? (field.on ?? 'Activée') : (field.off ?? 'Désactivée')}
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

      {kind === 'select' && (
        <select
          className={styles.select}
          value={value}
          onChange={e => setF({ [key]: e.target.value })}
        >
          {field.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {kind === 'color' && (
        <Swatches value={value} onChange={c => setF({ [key]: c })} />
      )}
    </div>
  );
}

function SchemaForm({ fields, form, defaults, setF }) {
  return fields.map((f, i) => (
    <SchemaField key={f.key ?? `${f.kind}-${i}`} field={f} form={form} defaults={defaults} setF={setF} />
  ));
}

// ── PatternPanel ──────────────────────────────────────────────────────────────

export default function PatternPanel({ patterns, onChange, onClose }) {
  const [editingType, setEditingType] = useState(null);
  const [form, setForm]               = useState({});
  const setF = patch => setForm(f => ({ ...f, ...patch }));

  // Merge stored patterns with PATTERN_TYPES so new patterns always appear.
  const merged = PATTERN_TYPES.map(pt => {
    const stored = patterns.find(p => p.type === pt.type);
    return stored ? { ...pt, ...stored } : { ...pt, enabled: true };
  });

  const emit = updated => onChange(updated);

  const toggleEnabled = type =>
    emit(merged.map(p => p.type === type ? { ...p, enabled: !p.enabled } : p));

  const startEdit = pat => {
    if (editingType === pat.type) { setEditingType(null); return; }
    setEditingType(pat.type);
    setForm({ ...pat });
  };

  const save = () => {
    emit(merged.map(p => p.type === form.type ? { ...p, ...form } : p));
    setEditingType(null);
  };

  const editingMeta = PATTERN_TYPES.find(pt => pt.type === editingType);

  return (
    <div
      className={styles.overlay}
      onClick={e => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pat-title"
    >
      <div className={styles.panel}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>
        <h2 id="pat-title" className={styles.title}>Patterns</h2>

        {/* ── Pattern list ───────────────────────────────────────────── */}
        <ul className={styles.list}>
          {merged.map(pat => {
            const isEditing = editingType === pat.type;
            return (
              <li
                key={pat.type}
                className={`${styles.patRow}${isEditing ? ` ${styles.patRowEditing}` : ''}`}
              >
                <span className={styles.dot} style={{ background: pat.color }} />
                <span className={styles.patLabel} style={{ color: pat.color }}>{pat.label}</span>
                <span className={styles.patDesc}>{pat.desc}</span>
                <button
                  className={`${styles.editBtn}${isEditing ? ` ${styles.editBtnActive}` : ''}`}
                  onClick={() => startEdit(pat)}
                  aria-label={`Configurer ${pat.label}`}
                >✎</button>
                <button
                  className={`${styles.toggle}${pat.enabled ? ` ${styles.toggleOn}` : ''}`}
                  onClick={() => toggleEnabled(pat.type)}
                  aria-pressed={pat.enabled}
                  aria-label={`${pat.enabled ? 'Désactiver' : 'Activer'} ${pat.label}`}
                >
                  <span className={styles.toggleKnob} />
                </button>
              </li>
            );
          })}
        </ul>

        {/* ── Config form ────────────────────────────────────────────── */}
        {/* Twins Bars — aucun champ écrit ici : tout vient de lib/twins/params.js.
            Le formulaire était écrit à la main comme ceux du FVG et du rFVG ; il
            est passé au schéma le jour où le motif a gagné ses positions, sinon
            chaque réglage de sortie aurait été un bloc JSX de plus. */}
        {editingType === 'TWINS_BARS' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>deux bougies opposées à corps plein · entrée au marché</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={TWINS_FIELDS} form={form} defaults={TWINS_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'FVG' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>zones d'imbalance</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ Haussier' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ Baissier' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur haussière</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur baissière</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Gaps comblés (grisés)</span>
                <button
                  className={`${styles.toggleBtn}${form.showMitigated !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showMitigated: form.showMitigated === false })}
                >
                  {form.showMitigated !== false ? 'Affichés' : 'Masqués'}
                </button>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>iFVG (inversion)</span>
                <button
                  className={`${styles.toggleBtn}${form.showInverse !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showInverse: form.showInverse === false })}
                >
                  {form.showInverse !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Étirement max (barres, 0 = illimité)</span>
                <NumInput
                  value={form.maxLen ?? 0}
                  min={0} max={500} step={1}
                  onChange={v => setF({ maxLen: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Gap minimum (points, 0 = tous)</span>
                <NumInput
                  value={form.minPts ?? 0}
                  min={0} max={100000} step={0.1}
                  onChange={v => setF({ minPts: v })}
                />
              </div>
            </div>

            {/* Filtre ATR sur la bougie centrale — celle qui creuse le gap.
                Écarte à la fois les gaps laissés par une bougie insignifiante et
                ceux laissés par un pic. 0 = borne désactivée. */}
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>ATR — période</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Bougie centrale ≥ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMin ?? 0}
                  min={0} max={20} step={0.1}
                  onChange={v => setF({ atrMin: v })}
                />
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Bougie centrale ≤ ATR × (0 = off)</span>
              <NumInput
                value={form.atrMax ?? 0}
                min={0} max={20} step={0.1}
                onChange={v => setF({ atrMax: v })}
              />
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* xFVG — aucun champ écrit ici : tout vient de lib/xfvg/params.js. */}
        {editingType === 'XFVG' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>imbalance 3 bougies, sans moyennes</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={XFVG_FIELDS} form={form} defaults={XFVG_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* xFVG+ — aucun champ écrit ici : tout vient de lib/xfvgx/params.js, qui
            réutilise lui-même les blocs de figure du xFVG. */}
        {editingType === 'XFVGX' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>la zone contient le swing cassé · entrée au retour</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={XFVGX_FIELDS} form={form} defaults={XFVGX_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* liq — aucun champ écrit ici : tout vient de lib/liq/params.js. */}
        {editingType === 'LIQ' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>impulsion · respiration · impulsion inverse</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={LIQ_FIELDS} form={form} defaults={LIQ_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* rev — aucun champ écrit ici : tout vient de lib/rev/params.js. */}
        {editingType === 'REV' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>pause · impulsion · impulsion inverse</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={REV_FIELDS} form={form} defaults={REV_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* ringble — aucun champ écrit ici : tout vient de lib/ringble/params.js. */}
        {editingType === 'RINGBLE' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>HB · BH — deux bougies opposées</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={RINGBLE_FIELDS} form={form} defaults={RINGBLE_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* super avalante — aucun champ écrit ici : tout vient de lib/superAval/params.js. */}
        {editingType === 'SUPER_AVAL' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>une bougie qui en avale plusieurs</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={SUPER_AVAL_FIELDS} form={form} defaults={SUPER_AVAL_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* RSIER — aucun champ écrit ici : tout vient de lib/rsier/params.js. */}
        {editingType === 'RSIER' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>surzones du RSI d’un HTF</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={RSIER_FIELDS} form={form} defaults={RSIER_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* TRENDER — aucun champ écrit ici : tout vient de lib/trender/params.js. */}
        {editingType === 'HARMONY' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>harmonie multi-HTF</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <SchemaForm fields={TRENDER_FIELDS} form={form} defaults={TRENDER_DEFAULTS} setF={setF} />

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'RFVG' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>gap laissé par une bougie large</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <p className={styles.hint}>
              Motif de base : une bougie baissière (ou haussière) d'une taille ≥ x × ATR, laissant un
              gap entre la bougie précédente et la suivante.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Motifs retenus</span>
              <div className={styles.segmented}>
                {[
                  { value: 'rfvg',  label: 'Seuls les rFVG' },
                  { value: 'all',   label: 'Toutes (aFVG)' },
                  { value: 'super', label: 'superFVG' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.mode ?? 'rfvg') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ mode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.hint}>
              <b>rFVG</b> : la bougie doit en plus être entièrement du côté opposé à son sens par rapport
              à la MM (baissière au-dessus, haussière en dessous) — c'est le motif de retournement.
              <b> aFVG</b> : la MM n'est plus regardée, tout motif de base compte (les rFVG en font partie).
              Chaque zone est étiquetée selon ce qu'elle est vraiment.
              <b> superFVG</b> : sous-ensemble des rFVG dont la 3e bougie (celle qui referme le gap)
              clôture à contre-sens du motif — rFVG haussier + 3e bougie baissière, ou rFVG baissier
              + 3e bougie haussière.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Premier du côté de la MM lente</span>
              <button
                className={`${styles.toggleBtn}${form.firstSlowSide === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ firstSlowSide: form.firstSlowSide !== true })}
              >
                {form.firstSlowSide === true ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            <p className={styles.hint}>
              Filtre fait pour l'<b>aFVG</b>. Ne garde que le <b>premier</b> motif de chaque sens dont la
              zone est <b>entièrement</b> du bon côté de la MM lente : bas de la boîte au-dessus de la MM
              si haussier, haut de la boîte en dessous si baissier — les deux bornes, pas la bougie
              centrale. Une fois un motif retenu, le sens se tait jusqu'à ce que le prix repasse de
              l'autre côté (une bougie qui clôture sous la MM lente réarme le haussier, au-dessus le
              baissier) : chaque nouveau régime a droit à son premier. Les motifs recalés par les
              autres filtres ne consomment pas le tour. En mode « Seuls les rFVG » ou « superFVG » il
              ne laisse presque rien passer : ces modes veulent la centrale du côté OPPOSÉ.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Centrale à cheval sur la MM lente</span>
              <button
                className={`${styles.toggleBtn}${form.slowStraddle === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ slowStraddle: form.slowStraddle !== true })}
              >
                {form.slowStraddle === true ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            <p className={styles.hint}>
              Second filtre fait pour l'<b>aFVG</b>, indépendant du précédent. La 2e bougie du motif —
              la centrale, celle qui creuse le gap — doit être <b>coupée</b> par la MM lente : son plus
              bas en dessous ET son plus haut au-dessus. C'est l'amplitude qui est jugée, mèche
              comprise ; le corps a le droit de rester d'un seul côté. Effleurer la MM ne suffit pas.
              Il contredit les modes « Seuls les rFVG » et « superFVG », qui veulent la centrale
              entièrement d'un côté — sauf si « MM lente — ouverture seule » est activé, la centrale
              a alors le droit de traverser.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Paire de sens contraires</span>
              <button
                className={`${styles.toggleBtn}${form.pairOpposite === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ pairOpposite: form.pairOpposite !== true })}
              >
                {form.pairOpposite === true ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            <p className={styles.hint}>
              Ne garde que les motifs qui vont <b>par deux</b>, emboîtés et opposés : la <b>3e bougie du
              premier</b> est la <b>1re du second</b>, donc les deux bougies centrales sont à deux barres
              d'écart et l'ensemble tient sur 5 bougies. Le second doit être de sens contraire au
              premier. Les <b>deux</b> zones sont dessinées, chacune avec sa boîte. Chaque motif est
              d'abord un aFVG complet : il passe tous les autres filtres avant d'être apparié. Les
              paires peuvent s'enchaîner (centrales i, i+2, i+4 de sens alternés = deux paires,
              trois zones) et se chevaucher (deux centrales voisines portant chacune la sienne).
              Ici <b>Direction</b> change de sens : elle ne trie plus les zones une à une
              — ça couperait les paires en deux — mais choisit les <b>paires</b> par le sens du premier
              motif. À ne pas combiner avec « Premier du côté de la MM lente » : celui-ci ne garde
              qu'un motif par sens et par régime, une paire n'y survit pas.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ Haussier' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ Baissier' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur haussière</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur baissière</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.sectionDivider}>Bougie centrale</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>MM rapide — période</span>
                <NumInput
                  value={form.maPeriodFast ?? 15}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodFast: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>MM lente — période</span>
                <NumInput
                  value={form.maPeriodSlow ?? 200}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodSlow: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              La bougie doit être entièrement d'un côté des DEUX moyennes à la fois : son plus bas
              au-dessus de la MM rapide ET de la MM lente (baissier), son plus haut en dessous des
              deux (haussier). Elle ne touche jamais aucune des deux. En mode « Toutes », les MM ne
              filtrent plus rien mais servent encore à étiqueter les zones.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>MM lente — ouverture seule</span>
              <button
                className={`${styles.toggleBtn}${form.slowOpenOnly === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ slowOpenOnly: form.slowOpenOnly !== true })}
              >
                {form.slowOpenOnly === true ? 'Activée' : 'Désactivée'}
              </button>
            </div>
            <p className={styles.hint}>
              Desserre la MM LENTE, et elle seule : seule l'OUVERTURE de la centrale doit être du bon
              côté — au-dessus si baissière, en dessous si haussière — sa clôture a le droit d'être de
              l'autre. La bougie traverse alors la MM lente au lieu de rester à distance. La MM rapide
              reste jugée mèche comprise.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Mesure de la taille</span>
              <div className={styles.segmented}>
                {[
                  { value: 'range', label: 'Amplitude (H−B)' },
                  { value: 'body',  label: 'Corps (|C−O|)' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.sizeMode ?? 'range') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ sizeMode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Période ATR</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Taille ≥ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMult ?? 1.5}
                  min={0} max={20} step={0.1}
                  onChange={v => setF({ atrMult: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              L'ATR est lu sur la bougie qui précède, sinon il contiendrait déjà la bougie à qualifier.
              Plus haut = déplacements plus violents, moins de signaux.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Corps 3e bougie ≤ ATR × (0 = OFF)</span>
              <NumInput
                value={form.atrMult3 ?? 0}
                min={0} max={20} step={0.1}
                onChange={v => setF({ atrMult3: v })}
              />
            </div>
            <p className={styles.hint}>
              Impose une 3e bougie petite : son corps |clôture−ouverture| doit rester sous ce multiple
              de l'ATR, lu sur la centrale. Toujours le corps, même en mesure « Amplitude ».
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Mèche de rejet sur la 3e bougie</span>
              <button
                className={`${styles.toggleBtn}${form.wick3 === true ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ wick3: form.wick3 !== true })}
              >
                {form.wick3 === true ? 'Activée' : 'Désactivée'}
              </button>
            </div>
            <p className={styles.hint}>
              La mèche de la 3e bougie du côté d'où vient le motif doit dépasser son corps : mèche
              BASSE &gt; corps sur un rFVG haussier, mèche HAUTE &gt; corps sur un baissier. Avec le
              réglage ci-dessus, ça exige un marteau (haussier) ou une étoile filante (baissier).
            </p>

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.field}>
              <span className={styles.label}>Représentation</span>
              <div className={styles.segmented}>
                {[
                  { value: 'zone',     label: 'Zone' },
                  { value: 'position', label: 'Position' },
                  { value: 'both',     label: 'Les deux' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.display ?? 'zone') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ display: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.display ?? 'zone') !== 'zone' && (
              <>
                <p className={styles.hint}>
                  Entrée AU MARCHÉ à l'ouverture de B4, la bougie qui suit le motif (achat sur zone
                  haussière, vente sur baissière) : plus d'ordre en attente, la position est
                  toujours prise. Le stop n'est pas une distance — il est posé à la CLÔTURE de B4
                  sous l'extrême B3-B4 (haussier) ou dessus (baissier), marge comprise. Pendant
                  toute B4 la position est donc non protégée, seul le TP est actif ; le stop étant
                  construit sous l'extrême de B4, il ne peut pas y être touché. Ensuite elle court
                  jusqu'au TP ou au SL (les deux dans la même bougie : le SL gagne, pessimiste). Le
                  trait épais au milieu donne l'issue : <b>vert</b> TP, <b>rouge</b> SL.
                </p>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>SL — marge sous/sur l'extrême B3-B4 (points)</span>
                    <NumInput
                      value={form.slMarginPts ?? 2}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ slMarginPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>TP (points)</span>
                    <NumInput
                      value={form.tpPts ?? 10}
                      min={0.1} max={100000} step={0.1}
                      onChange={v => setF({ tpPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Le risque varie donc d'une position à l'autre : c'est la taille de B3-B4 qui le
                  fait, plus la marge. Le RR n'est plus un réglage — le moniteur et le rapport en
                  donnent la moyenne, et tout ce qui est en R est normalisé position par position.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>SL plafonné — perte max (points, 0 = OFF)</span>
                    <NumInput
                      value={form.slCapPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ slCapPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Spread (points)</span>
                    <NumInput
                      value={form.spreadPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ spreadPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Un vrai SL, pas un break-even : la position est soldée dès ce nombre de points
                  contre l'entrée, même si le SL structurel n'est pas atteint (issue <b>rouge</b>,
                  comme un SL). Le stop retenu est le <b>plus serré</b> des deux, donc le risque
                  cesse de varier au-delà de ce plafond. C'est aussi le seul stop actif pendant B4 :
                  posé avec l'ordre, il n'a pas besoin de la clôture de B4 pour exister.
                </p>
                <p className={styles.hint}>
                  Le <b>spread</b> est déduit de chaque position <b>clôturée</b> : le moniteur, le
                  rapport et la couleur des trades passent au <b>net</b>. Le profit brut reste dans le
                  rapport à côté du net — c'est lui qui se relit entre les deux traits du graphe. Une
                  sortie BE au prix d'entrée rend donc un brut nul et un net négatif : le spread reste
                  dû. Mettre ici le vrai spread du symbole est le seul moyen de voir si l'edge y survit.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Trade unique</span>
                  <button
                    className={`${styles.toggleBtn}${form.uniqueTrade === true ? ` ${styles.toggleBtnOn}` : ''}`}
                    onClick={() => setF({ uniqueTrade: form.uniqueTrade !== true })}
                  >
                    {form.uniqueTrade === true ? 'Activé' : 'Désactivé'}
                  </button>
                </div>
                <p className={styles.hint}>
                  Une seule position à la fois. Tant qu'elle n'est pas clôturée, tout nouveau motif
                  est ignoré — dans le sens de la position en cours comme à contre-sens : il ne
                  produit rien du tout. L'entrée se faisant à l'ouverture de B4, un motif dont B4
                  tombe sur la bougie de sortie de la position précédente est ignoré lui aussi :
                  à ce premier prix, la position vit encore.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Signaux à sauter après un TP (0 = off)</span>
                  <NumInput
                    value={form.skipAfterTp ?? 0}
                    min={0} max={500} step={1}
                    onChange={v => setF({ skipAfterTp: v })}
                  />
                </div>
                <p className={styles.hint}>
                  Après un gain (TP), on saute les N prochains signaux — le temps de se remettre en
                  condition. Chaque signal sauté est quand même simulé à blanc : s'il aurait AUSSI
                  gagné, le compteur repart à N (on continue de se reposer tant que le marché aurait
                  payé). Les trades sautés ne comptent pas dans le rapport, seulement dans le calcul
                  du compteur. Anti-lookahead : un signal n'est sauté que s'il entre après la sortie
                  du gain qui a armé le repos — garanti en <b>trade unique</b>, à activer de préférence
                  avec.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : seuil d'activation (points, 0 = off)</span>
                    <NumInput
                      value={form.beTriggerPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ beTriggerPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : niveau (points vs entrée)</span>
                    <NumInput
                      value={form.beLevelPts ?? 0}
                      min={-100000} max={100000} step={0.1}
                      onChange={v => setF({ beLevelPts: v })}
                    />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Coupe sur retours à l'entrée (nb, 0 = off)</span>
                    <NumInput
                      value={form.beTouchTrigger ?? 0}
                      min={0} max={500} step={1}
                      onChange={v => setF({ beTouchTrigger: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE sur durée (bougies tenues, 0 = off)</span>
                    <NumInput
                      value={form.beBarsTrigger ?? 0}
                      min={0} max={5000} step={1}
                      onChange={v => setF({ beBarsTrigger: v })}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>BE sur swing (bougies de chaque côté, 0 = off)</span>
                  <NumInput
                    value={form.beSwingBars ?? 0}
                    min={0} max={50} step={1}
                    onChange={v => setF({ beSwingBars: v })}
                  />
                </div>
                <p className={styles.hint}>
                  <b>Swing</b> déplace le <b>stop</b> sous la structure, pas au BE : on attend le
                  premier swing formé pendant la position — un swing <b>bas</b> en BUY, <b>haut</b>
                  {' '}en SELL, confirmé par N bougies avant et N après (2 = la définition
                  habituelle, la même que l'indicateur SWING) — et le stop passe sous ce swing bas
                  (ou sur ce swing haut) avec la <b>marge du SL</b>. Le swing n'étant connu qu'à la
                  clôture de la Nième bougie qui le suit, le stop ne bouge que là : pas de
                  lookahead. Un seul déplacement, sur le premier swing, et jamais dans le sens qui
                  élargit le risque.
                </p>
                <p className={styles.hint}>
                  Quatre déclencheurs indépendants, aux effets différents.
                  {' '}<b>Profit</b> et <b>Durée</b> déplacent le <b>stop</b> à entrée ± niveau
                  (0 = entrée exacte, positif = gain verrouillé, négatif = perte réduite ; jamais
                  au-delà du stop structurel) — profit dès que le gain atteint le seuil (évalué dès
                  B4), durée dès que la position tient depuis N bougies. Sortie sur ce stop :
                  trait <b style={{ color: '#F59E0B' }}>ambre</b>.
                  {' '}<b>Retours</b> ne déplace rien : il <b>coupe</b>. Dès que le prix est revenu
                  N fois sur l'entrée, la position est soldée <b>au prix d'entrée</b> — sortie
                  {' '}<b style={{ color: '#F59E0B' }}>ambre</b> elle aussi, gain brut nul, le
                  spread reste dû. C'est un abandon, pas une protection : le motif n'a pas
                  travaillé, on rend la place. Pessimiste : stop et TP testés avant les
                  déclencheurs (un TP l'emporte sur sa bougie), un BE traversé en gap rempli au
                  pire de l'open. <b>Profit</b>, <b>Durée</b> et <b>Swing</b>
                  {' '}déplacent tous les trois le stop, mais il ne bouge qu'<b>une fois</b> : le
                  premier armé pose le stop, les suivants ne le rejouent pas.
                </p>

                <div className={styles.sectionDivider}>Le dû</div>

                <div className={styles.field}>
                  <span className={styles.label}>Dû — seuil (pertes non remboursées, 0 = off)</span>
                  <NumInput
                    value={form.dueAfterSl ?? 0}
                    min={0} max={100} step={1}
                    onChange={v => setF({ dueAfterSl: v })}
                  />
                </div>
                <p className={styles.hint}>
                  <b>Rembourser avant de gagner.</b> Chaque position clôturée dans le rouge laisse
                  sa perte sur une ardoise ; chaque gain la rembourse en commençant par la plus
                  {' '}<b>ancienne</b>. Dès que l'ardoise compte ce nombre de pertes, la position
                  suivante vise la <b>somme</b> de l'ardoise au lieu de son vrai TP — et elle la vise
                  même si c'est plus <b>près</b> que son objectif normal. Une fois remboursé, le
                  motif repart sur son vrai TP. Même règle et même code que le Twins Bars.
                </p>

                {(form.dueAfterSl ?? 0) > 0 && (
                  <>
                    <div className={styles.field}>
                      <span className={styles.label}>Remboursement</span>
                      <div className={styles.segmented}>
                        {[
                          { value: 'full', label: "Tout d'un coup" },
                          { value: 'step', label: 'Par bonds' },
                        ].map(o => (
                          <button
                            key={o.value}
                            className={`${styles.segBtn}${(form.dueMode ?? 'full') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                            onClick={() => setF({ dueMode: o.value })}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className={styles.hint}>
                      {(form.dueMode ?? 'full') === 'step' ? (
                        <>
                          Par <b>bonds</b> de « seuil × perte moyenne encore due » — la taille exacte
                          de ce qui a armé le dû. Au moment de l'armement c'est toute l'ardoise ;
                          ensuite, si elle a grossi, c'en est une fraction, et il faudra plusieurs
                          remboursements. L'idée : un objectif qui garde la même taille au lieu de
                          fuir avec l'ardoise.
                        </>
                      ) : (
                        <>
                          <b>Tout d'un coup</b> : l'objectif vaut l'ardoise <b>entière</b>. Plus elle
                          grossit, plus il s'éloigne — au bout d'une longue série il peut devenir hors
                          d'atteinte, et un objectif qu'on n'atteint pas ne rembourse rien.
                          {' '}« Par bonds » existe pour ça.
                        </>
                      )}
                    </p>
                    <p className={styles.hint}>
                      Le dû se compte en points <b>nets</b> : une sortie au break-even qui finit sous
                      zéro (le spread) est une perte et compte dans le seuil. Avec un spread,
                      rembourser ne solde donc jamais tout à fait — le gain qui atteint le dû paie lui
                      aussi son aller-retour, et il reste exactement un spread sur l'ardoise. Le
                      {' '}<b>break-even n'est pas touché</b> : ses quatre déclencheurs s'arment aux
                      mêmes distances que sur une position ordinaire. Le dû déplace la cible, pas la
                      protection.
                    </p>
                    {form.uniqueTrade !== true && (
                      <p className={styles.hint}>
                        ⚠ Sans <b>trade unique</b>, les positions se chevauchent : une sortie ne pèse
                        sur le dû d'une entrée que si elle a eu lieu <b>avant</b> elle. Le dû lu par
                        une position peut donc être plus petit que l'ardoise réelle au même instant —
                        c'est le prix de ne pas remonter le temps.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Extension max (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={500} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Gap minimum (points, négatif OK)</span>
                <NumInput
                  value={form.minPts ?? 0}
                  min={-100000} max={100000} step={0.1}
                  onChange={v => setF({ minPts: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              La zone est tirée à droite sur ce nombre de barres puis coupée net.
              Le gap minimum est <b>signé</b> : 0 exige un vrai vide entre la 1re et
              la 3e bougie, une valeur <b>négative</b> accepte qu'elles se chevauchent
              jusqu'à cette profondeur — la zone est alors la bande commune aux deux
              bougies au lieu du vide.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Hauteur max de la zone (points, 0 = off)</span>
              <NumInput
                value={form.maxPts ?? 0}
                min={0} max={100000} step={0.1}
                onChange={v => setF({ maxPts: v })}
              />
            </div>
            <p className={styles.hint}>
              Ne garde que les motifs dont la zone est <b>haute d'au plus</b> ce nombre de points :
              à 5, seuls les gaps de 5 points ou moins s'affichent. C'est la <b>boîte telle qu'elle
              est dessinée</b> qui est mesurée, donc la valeur absolue du gap — un chevauchement de
              8 points fait une zone de 8, comme un vide de 8. Avec le <b>gap minimum</b> juste
              au-dessus, la zone se trouve encadrée des deux côtés ; ici c'est le plafond, là-bas le
              plancher. <b>0 = aucun plafond</b>, le motif est celui d'avant.
            </p>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'KO' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>2 bougies — impulsion pleine, puis respiration</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <p className={styles.hint}>
              <b>B1</b> — l'impulsion : bougie <b>pleine</b> (gros corps, peu de mèche) entièrement
              du côté opposé à son sens par rapport aux <b>deux</b> MM. Haussière sous les deux MM
              → KO <b>haussier</b> ; baissière au-dessus des deux → KO <b>baissier</b>.
              <b> B2</b> — la respiration : petite et indécise, <b>quel que soit son sens</b>.
              Entrée à l'ouverture de la 3e bougie.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ Haussier' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ Baissier' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur haussière</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur baissière</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.sectionDivider}>Moyennes mobiles</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>MM rapide — période</span>
                <NumInput
                  value={form.maPeriodFast ?? 15}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodFast: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>MM lente — période</span>
                <NumInput
                  value={form.maPeriodSlow ?? 200}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriodSlow: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              B1 doit être entièrement d'un côté des DEUX moyennes à la fois, <b>mèches
              comprises</b> : son plus haut sous les deux (haussière) ou son plus bas au-dessus des
              deux (baissière). Elle n'en touche aucune. B2, elle, est libre : elle ne porte pas le
              motif, elle le confirme par sa petitesse.
            </p>

            <div className={styles.sectionDivider}>B1 — l'impulsion</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Période ATR</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Corps ≥ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMult1 ?? 1.3}
                  min={0} max={20} step={0.1}
                  onChange={v => setF({ atrMult1: v })}
                />
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Corps / amplitude ≥ (0 = off)</span>
              <NumInput
                value={form.bodyRatio1 ?? 0.9}
                min={0} max={1} step={0.05}
                onChange={v => setF({ bodyRatio1: v })}
              />
            </div>
            <p className={styles.hint}>
              Deux conditions à passer ensemble : la bougie est <b>grosse</b> (corps vs ATR) et
              <b> pleine</b> (0,9 = au plus 10 % de mèche). L'ATR est lu <b>avant B1</b>, sinon il
              contiendrait déjà la bougie à qualifier — et c'est le <b>même</b> ATR qui sert aux
              deux bougies, pour que « ATR » ne désigne qu'une seule chose dans le motif.
            </p>

            <div className={styles.sectionDivider}>B2 — la respiration</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Corps ≤ ATR × (0 = off)</span>
                <NumInput
                  value={form.atrMult2 ?? 0.3}
                  min={0} max={20} step={0.05}
                  onChange={v => setF({ atrMult2: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Corps / amplitude ≤ (1 = off)</span>
                <NumInput
                  value={form.bodyRatio2 ?? 0.3}
                  min={0} max={1} step={0.05}
                  onChange={v => setF({ bodyRatio2: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              Miroir de B1 : petite dans l'absolu <i>et</i> indécise dans sa forme (surtout de la
              mèche). Son <b>sens n'entre pas</b> dans le motif — haussière ou baissière, seule sa
              taille compte. Une bougie parfaitement plate (haut = bas) passe : c'est le comble de
              l'indécision.
            </p>

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.field}>
              <span className={styles.label}>Représentation</span>
              <div className={styles.segmented}>
                {[
                  { value: 'zone',     label: 'Zone' },
                  { value: 'position', label: 'Position' },
                  { value: 'both',     label: 'Les deux' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.display ?? 'zone') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ display: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.display ?? 'zone') !== 'zone' && (
              <>
                <p className={styles.hint}>
                  Entrée AU MARCHÉ à l'ouverture de la 3e bougie (achat sur motif haussier, vente
                  sur baissier) : pas d'ordre en attente, la position est toujours prise. Le stop
                  n'est pas une distance — il est posé à la <b>clôture</b> de la bougie d'entrée
                  sous l'extrême <b>B2–B3</b> (haussier) ou dessus (baissier), marge comprise. La
                  grosse bougie B1 n'entre <b>pas</b> dans le stop : c'est ce qui rend le risque
                  petit et l'invalidation nette. Pendant toute la bougie d'entrée la position est
                  non protégée, seul le TP est actif. Trait épais : <b>vert</b> TP, <b>rouge</b> SL,
                  <b style={{ color: '#F59E0B' }}> ambre</b> BE.
                </p>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>SL — marge sous/sur l'extrême B2-B3 (points)</span>
                    <NumInput
                      value={form.slMarginPts ?? 2}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ slMarginPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>TP (points)</span>
                    <NumInput
                      value={form.tpPts ?? 10}
                      min={0.1} max={100000} step={0.1}
                      onChange={v => setF({ tpPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Le risque varie d'une position à l'autre : c'est la taille de B2-B3 qui le fait,
                  plus la marge. Le RR n'est donc pas un réglage. Tout se compte en <b>points</b>,
                  à lot fixe. Le calibrage sérieux (par symbole, in-sample / out-of-sample, contrôle
                  par décalage) se fait sur la page <b>/ko</b>, pas ici : le graphe ne voit que les
                  bougies chargées.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>SL plafonné — perte max (points, 0 = OFF)</span>
                    <NumInput
                      value={form.slCapPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ slCapPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Spread (points)</span>
                    <NumInput
                      value={form.spreadPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ spreadPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Un vrai SL, pas un break-even : la position est soldée dès ce nombre de points
                  contre l'entrée, même si le SL structurel n'est pas atteint. Le stop retenu est le
                  <b> plus serré</b> des deux, et c'est le seul actif pendant la bougie d'entrée —
                  une distance n'a pas besoin d'attendre une clôture pour être posée.
                </p>
                <p className={styles.hint}>
                  Le <b>spread</b> est déduit de chaque position <b>clôturée</b> : moniteur, rapport
                  et couleur des trades passent au <b>net</b>, le brut restant lisible à côté. Une
                  sortie BE au prix d'entrée rend un brut nul et un net négatif — le spread reste dû.
                </p>

                <div className={styles.field}>
                  <span className={styles.label}>Trade unique</span>
                  <button
                    className={`${styles.toggleBtn}${form.uniqueTrade === true ? ` ${styles.toggleBtnOn}` : ''}`}
                    onClick={() => setF({ uniqueTrade: form.uniqueTrade !== true })}
                  >
                    {form.uniqueTrade === true ? 'Activé' : 'Désactivé'}
                  </button>
                </div>
                <p className={styles.hint}>
                  Une seule position à la fois : tant qu'elle n'est pas clôturée, tout nouveau motif
                  est ignoré, dans son sens comme à contre-sens.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Signaux sautés après un TP (0 = off)</span>
                    <NumInput
                      value={form.skipAfterTp ?? 0}
                      min={0} max={50} step={1}
                      onChange={v => setF({ skipAfterTp: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Durée max (bougies, 0 = off)</span>
                    <NumInput
                      value={form.maxBars ?? 0}
                      min={0} max={20000} step={1}
                      onChange={v => setF({ maxBars: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Après un gain, on saute les N prochains signaux ; chaque signal sauté est simulé
                  à blanc et recharge le compteur s'il aurait aussi gagné. <b>Durée max</b> solde la
                  position à la clôture de la Nième bougie (statut « timeout ») au lieu de la
                  laisser ouverte jusqu'au bord des données.
                </p>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : seuil d'activation (points, 0 = off)</span>
                    <NumInput
                      value={form.beTriggerPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ beTriggerPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE : niveau (points vs entrée)</span>
                    <NumInput
                      value={form.beLevelPts ?? 0}
                      min={-100000} max={100000} step={0.1}
                      onChange={v => setF({ beLevelPts: v })}
                    />
                  </div>
                </div>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Coupe sur retours à l'entrée (nb, 0 = off)</span>
                    <NumInput
                      value={form.beTouchTrigger ?? 0}
                      min={0} max={100} step={1}
                      onChange={v => setF({ beTouchTrigger: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>BE sur durée (bougies tenues, 0 = off)</span>
                    <NumInput
                      value={form.beBarsTrigger ?? 0}
                      min={0} max={5000} step={1}
                      onChange={v => setF({ beBarsTrigger: v })}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.label}>BE sur swing (bougies de chaque côté, 0 = off)</span>
                  <NumInput
                    value={form.beSwingBars ?? 0}
                    min={0} max={50} step={1}
                    onChange={v => setF({ beSwingBars: v })}
                  />
                </div>
                <p className={styles.hint}>
                  Quatre déclencheurs, aux effets différents. <b>Profit</b> et <b>Durée</b> déplacent
                  le <b>stop</b> à entrée ± niveau (jamais au-delà du stop structurel).
                  {' '}<b>Swing</b> le déplace sous la <b>structure</b> : au premier swing formé
                  pendant la position (bas en BUY, haut en SELL, confirmé par N bougies de chaque
                  côté), avec la marge du SL. <b>Retours</b> ne déplace rien et <b>coupe</b> la
                  position au prix d'entrée après N retours sur l'entrée. Les trois premiers se partagent
                  <b> un seul</b> déplacement : le premier armé pose le stop. Réglages identiques à
                  ceux du rFVG — c'est le même moteur de sortie.
                </p>
              </>
            )}

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Extension de la zone (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={500} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              La boîte encadre les deux bougies du motif et se prolonge de ce nombre de barres à
              droite de B2, puis est coupée net.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Labels</span>
              <button
                className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ showLabel: form.showLabel === false })}
              >
                {form.showLabel !== false ? 'Activés' : 'Désactivés'}
              </button>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'HBH_BHB' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>3 bougies — englobante / milieu / clôture</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HBH' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BHB' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HBH (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BHB (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Multiple d'englobement min. (×2e)</span>
                <NumInput
                  value={form.engMult ?? 1.5}
                  min={1} max={5} step={0.1}
                  onChange={v => setF({ engMult: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Longueur zone (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={200} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Ligne médiane</span>
                <button
                  className={`${styles.toggleBtn}${form.showMid !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showMid: form.showMid === false })}
                >
                  {form.showMid !== false ? 'Affichée' : 'Masquée'}
                </button>
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Labels</span>
              <button
                className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                onClick={() => setF({ showLabel: form.showLabel === false })}
              >
                {form.showLabel !== false ? 'Activés' : 'Désactivés'}
              </button>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'HBHB_BHBH' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>4 bougies groupées alternées</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HBHB' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BHBH' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HBHB (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BHBH (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Multiple de corps min. (×2e bougie)</span>
                <NumInput
                  value={form.bodyMult ?? 1.5}
                  min={1} max={5} step={0.1}
                  onChange={v => setF({ bodyMult: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Longueur zone (barres)</span>
                <NumInput
                  value={form.extLen ?? 20}
                  min={1} max={200} step={1}
                  onChange={v => setF({ extLen: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              Corps bougie 1 et 3 doivent être ≥ bodyMult × corps bougie 2. La zone couvre le haut/bas de la 2e bougie.
            </p>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'COMPRESSION' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>squeeze TTM — Bollinger / Keltner</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur cassure haussière</span>
              <Swatches value={form.upColor ?? '#26A69A'} onChange={c => setF({ upColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur cassure baissière</span>
              <Swatches value={form.downColor ?? '#EF5350'} onChange={c => setF({ downColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#64748B' }}>Couleur en formation</span>
              <Swatches value={form.neutralColor ?? '#64748B'} onChange={c => setF({ neutralColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Méthode</span>
              <div className={styles.segmented}>
                {[
                  { value: 'atr',     label: 'ATR plat' },
                  { value: 'squeeze', label: 'Squeeze BB/KC' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.mode ?? 'atr') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ mode: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {(form.mode ?? 'atr') === 'atr' ? (
              <>
                <div className={styles.sectionDivider}>Détection (ATR plat)</div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période ATR</span>
                    <NumInput
                      value={form.atrPeriod ?? 14}
                      min={2} max={100} step={1}
                      onChange={v => setF({ atrPeriod: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Longueur min. (barres)</span>
                    <NumInput
                      value={form.minLength ?? 6}
                      min={2} max={50} step={1}
                      onChange={v => setF({ minLength: v })}
                    />
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Tolérance « plat » (±)</span>
                    <NumInput
                      value={form.flatTol ?? 0.12}
                      min={0.02} max={0.5} step={0.01}
                      onChange={v => setF({ flatTol: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Saut de cassure (×ATR)</span>
                    <NumInput
                      value={form.breakMult ?? 1.8}
                      min={1.1} max={4} step={0.1}
                      onChange={v => setF({ breakMult: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  L'ATR doit rester dans ±tolérance autour de sa moyenne (volatilité figée), puis
                  bondir d'au moins ×saut = cassure brusque. Tolérance plus basse = compression plus stricte.
                </p>
              </>
            ) : (
              <>
                <div className={styles.sectionDivider}>Détection (squeeze)</div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Période (BB/KC/ATR)</span>
                    <NumInput
                      value={form.length ?? 20}
                      min={5} max={100} step={1}
                      onChange={v => setF({ length: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Longueur min. (barres)</span>
                    <NumInput
                      value={form.minLength ?? 6}
                      min={2} max={50} step={1}
                      onChange={v => setF({ minLength: v })}
                    />
                  </div>
                </div>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>Multiplicateur Bollinger (σ)</span>
                    <NumInput
                      value={form.bbMult ?? 2}
                      min={1} max={4} step={0.1}
                      onChange={v => setF({ bbMult: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Multiplicateur Keltner (ATR)</span>
                    <NumInput
                      value={form.kcMult ?? 1.5}
                      min={1} max={4} step={0.1}
                      onChange={v => setF({ kcMult: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Squeeze quand les Bollinger rentrent dans les Keltner. Multiplicateur Bollinger plus
                  bas ou Keltner plus haut = détection plus stricte.
                </p>
              </>
            )}

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Opacité</span>
                <NumInput
                  value={form.opacity ?? 0.18}
                  min={0.05} max={0.6} step={0.01}
                  onChange={v => setF({ opacity: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Étirer jusqu'à la cassure</span>
                <button
                  className={`${styles.toggleBtn}${form.extendToBreak !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ extendToBreak: form.extendToBreak === false })}
                >
                  {form.extendToBreak !== false ? 'Oui' : 'Non'}
                </button>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Flèche de cassure</span>
                <button
                  className={`${styles.toggleBtn}${form.showArrow !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showArrow: form.showArrow === false })}
                >
                  {form.showArrow !== false ? 'Affichée' : 'Masquée'}
                </button>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Labels</span>
                <button
                  className={`${styles.toggleBtn}${form.showLabel !== false ? ` ${styles.toggleBtnOn}` : ''}`}
                  onClick={() => setF({ showLabel: form.showLabel === false })}
                >
                  {form.showLabel !== false ? 'Activés' : 'Désactivés'}
                </button>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {editingType === 'HMBM' && (
          <div className={styles.formSection}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle} style={{ color: editingMeta?.color }}>
                {editingMeta?.label}
              </span>
              <span className={styles.formSubtitle}>2 bougies — grosse contra-MM + petite</span>
              <button className={styles.formCloseBtn} onClick={() => setEditingType(null)}>×</button>
            </div>

            <p className={styles.hint}>
              Bougie 1 : grosse bougie directionnelle entièrement du mauvais côté de la MM
              (<b>HM</b> haussière sous la MM, <b>BM</b> baissière au-dessus), corps ≥ mult1 × ATR.
              Bougie 2 (M) : petite, corps ≤ mult2 × ATR. La bougie suivante (X) porte le niveau
              d'entrée (son ouverture) ; le SL est l'extrême entre M et X.
            </p>

            <div className={styles.field}>
              <span className={styles.label}>Direction</span>
              <div className={styles.segmented}>
                {[
                  { value: 'bull', label: '↑ HM' },
                  { value: 'both', label: '↕ Les deux' },
                  { value: 'bear', label: '↓ BM' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${form.direction === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ direction: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#26A69A' }}>Couleur HM (haussier)</span>
              <Swatches value={form.bullColor ?? '#26A69A'} onChange={c => setF({ bullColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label} style={{ color: '#EF5350' }}>Couleur BM (baissier)</span>
              <Swatches value={form.bearColor ?? '#EF5350'} onChange={c => setF({ bearColor: c })} />
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Couleur du SL</span>
              <Swatches value={form.slColor ?? '#B22222'} onChange={c => setF({ slColor: c })} />
            </div>

            <div className={styles.sectionDivider}>Bougie 1 (contra-MM, grosse)</div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>MM — période (SMA)</span>
                <NumInput
                  value={form.maPeriod ?? 75}
                  min={2} max={400} step={1}
                  onChange={v => setF({ maPeriod: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>ATR — période</span>
                <NumInput
                  value={form.atrPeriod ?? 14}
                  min={1} max={200} step={1}
                  onChange={v => setF({ atrPeriod: v })}
                />
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <span className={styles.label}>Bougie 1 — corps ≥ ATR ×</span>
                <NumInput
                  value={form.mult1 ?? 1}
                  min={0} max={10} step={0.1}
                  onChange={v => setF({ mult1: v })}
                />
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Bougie 2 — corps ≤ ATR ×</span>
                <NumInput
                  value={form.mult2 ?? 0.5}
                  min={0} max={10} step={0.05}
                  onChange={v => setF({ mult2: v })}
                />
              </div>
            </div>
            <p className={styles.hint}>
              L'ATR est lu sur la bougie qui précède la bougie 1, sinon il l'inclurait. Un seul ATR
              de référence sert aux deux tests (grosse bougie 1, petite bougie 2).
            </p>

            <div className={styles.sectionDivider}>Affichage</div>

            <div className={styles.field}>
              <span className={styles.label}>Représentation</span>
              <div className={styles.segmented}>
                {[
                  { value: 'levels',   label: 'Niveaux' },
                  { value: 'position', label: 'Position' },
                  { value: 'both',     label: 'Les deux' },
                ].map(o => (
                  <button
                    key={o.value}
                    className={`${styles.segBtn}${(form.display ?? 'levels') === o.value ? ` ${styles.segBtnActive}` : ''}`}
                    onClick={() => setF({ display: o.value })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Longueur niveaux entrée / SL (barres)</span>
              <NumInput
                value={form.extLen ?? 5}
                min={1} max={200} step={1}
                onChange={v => setF({ extLen: v })}
              />
            </div>

            {(form.display ?? 'levels') !== 'levels' && (
              <>
                <div className={styles.sectionDivider}>Position simulée</div>
                <p className={styles.hint}>
                  Entrée au marché à l'ouverture de la bougie X (toujours prise). Le SL est
                  l'extrême entre M et X (déjà connu) ; le TP est posé à cette distance en points.
                  Pas de break-even. Suivi à partir de X+1, stop testé avant le TP (pessimiste).
                  Le trait du milieu donne l'issue : <b>vert</b> TP, <b>rouge</b> SL, <b>gris</b> encore ouverte.
                </p>
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.label}>TP (points)</span>
                    <NumInput
                      value={form.tpPts ?? 10}
                      min={0.1} max={100000} step={0.1}
                      onChange={v => setF({ tpPts: v })}
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.label}>Spread (points)</span>
                    <NumInput
                      value={form.spreadPts ?? 0}
                      min={0} max={100000} step={0.1}
                      onChange={v => setF({ spreadPts: v })}
                    />
                  </div>
                </div>
                <p className={styles.hint}>
                  Le spread est déduit de chaque position <b>clôturée</b> : le brut reste dans le
                  rapport, le net est ce qu'on encaisse, et c'est lui que l'espérance affichée compte.
                </p>
              </>
            )}

            <button className={styles.saveBtn} onClick={save}>✓ Enregistrer</button>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className={styles.footer}>
          <button className={styles.allBtn}  onClick={() => emit(merged.map(p => ({ ...p, enabled: true })))}>
            Tout activer
          </button>
          <button className={styles.noneBtn} onClick={() => emit(merged.map(p => ({ ...p, enabled: false })))}>
            Tout désactiver
          </button>
        </div>
      </div>
    </div>
  );
}
