// Schéma des paramètres rFVG — génère le formulaire de la page ET valide les
// entrées de l'API. Les bornes ne sont pas décoratives : une valeur hors bornes
// est ramenée dans la plage et SIGNALÉE (`clamped`), jamais remplacée en
// silence — sinon on optimise autre chose que ce qu'on croit tester.
//
// Seule la DÉTECTION vit ici : les sorties (SL / TP / break-even) sont communes à
// tous les motifs et vivent dans lib/signals/params.js.
//
// DÉTECTION vs SORTIES : la séparation est la clé de l'optimiseur. Pour le rFVG,
// la détection est figée par l'utilisateur (c'est son motif, pas une variable
// libre) ; seules les sorties sont balayées. Ajouter la détection à la grille
// ferait sauter le budget de liberté (~30 positions par paramètre réglé) en deux
// paramètres. (Le KO, lui, autorise le balayage de détection : ses seuils sont
// neufs et personne ne sait encore où ils doivent tomber — cf. lib/ko/params.js.)

export { EXIT_SCHEMA, defaultsOf, sanitize, expandValues } from '../signals/params';
import { EXIT_SCHEMA } from '../signals/params';

export const DETECT_SCHEMA = [
  { key: 'mode',         label: 'Motifs retenus',          type: 'select', def: 'rfvg', options: ['rfvg', 'all', 'super', 'cfvg'],
    hint: 'rfvg = centrale à contre-courant des deux MM ; all = tout motif de base (aFVG inclus) ; super = les rFVG dont la 3e bougie clôture à contre-sens ; cfvg = l’inverse du rfvg — MM LENTE seule, centrale dans le sens de sa position (haussière au-dessus, baissière en dessous)' },
  { key: 'direction',    label: 'Direction',               type: 'select', def: 'both', options: ['both', 'bull', 'bear'] },
  { key: 'maPeriodFast', label: 'MM rapide',               type: 'int',   def: 15,  min: 2, max: 400 },
  { key: 'maPeriodSlow', label: 'MM lente',                type: 'int',   def: 200, min: 2, max: 400,
    hint: 'la centrale doit être entièrement du bon côté des DEUX MM à la fois' },
  { key: 'slowOpenOnly', label: 'MM lente : ouverture seule', type: 'bool', def: false,
    hint: 'desserre la MM LENTE seule : seule l’OUVERTURE de la centrale doit être du bon côté, sa clôture peut être de l’autre. La MM rapide reste jugée mèche comprise' },
  { key: 'firstSlowSide', label: 'Premier du côté de la MM lente', type: 'bool', def: false,
    hint: 'fait pour le mode « all » (aFVG) : ne garde que le PREMIER motif de chaque sens dont la ZONE ENTIÈRE est du bon côté de la MM lente — bas de la boîte au-dessus si haussier, haut en dessous si baissier. Le sens se réarme quand une bougie clôture de l’autre côté de la MM lente' },
  { key: 'slowStraddle', label: 'Centrale à cheval sur la MM lente', type: 'bool', def: false,
    hint: 'fait pour le mode « all » (aFVG) : la centrale doit être COUPÉE par la MM lente — plus bas en dessous ET plus haut au-dessus, mèche comprise. Contredit les modes « rfvg » et « super », sauf combiné à « ouverture seule »' },
  { key: 'pairOpposite', label: 'Paire de sens contraires', type: 'bool', def: false,
    hint: 'fait pour le mode « all » (aFVG) : ne garde que les motifs allant PAR DEUX, emboîtés — la 3e bougie du premier est la 1re du second, centrales à deux barres d’écart — et de sens contraires. Les deux zones sortent. « Direction » sélectionne alors les paires par le sens du PREMIER motif' },
  { key: 'sizeMode',     label: 'Mesure de la centrale',   type: 'select', def: 'range', options: ['range', 'body'] },
  { key: 'atrPeriod',    label: 'ATR — période',           type: 'int',   def: 14, min: 1, max: 100 },
  { key: 'atrMult',      label: 'Centrale ≥ ATR ×',        type: 'float', def: 1.5, min: 0, max: 10, step: 0.1, hint: '0 = filtre de taille désactivé' },
  { key: 'atrMult3',     label: 'Corps 3e bougie ≤ ATR ×', type: 'float', def: 0,   min: 0, max: 10, step: 0.1, hint: '0 = désactivé' },
  { key: 'wick3',        label: 'Mèche de rejet 3e bougie', type: 'bool', def: false },
  { key: 'minPts',       label: 'Gap minimum (prix, signé)', type: 'float', def: 0, min: -100000, max: 100000, step: 0.1,
    hint: '0 = vrai vide entre 1re et 3e bougie ; négatif = accepte le chevauchement' },
  { key: 'maxPts',       label: 'Hauteur max de la zone (points)', type: 'float', def: 0, min: 0, max: 100000, step: 0.1,
    hint: '0 = désactivé. Ne garde que les motifs dont la zone est HAUTE d’au plus ce nombre de points — la boîte telle qu’elle est dessinée, donc |gap| : un chevauchement de 8 points est une zone de 8, comme un vide de 8. Se combine avec le gap minimum, qui borne l’autre bout' },
];

export const ALL_SCHEMA = [...DETECT_SCHEMA, ...EXIT_SCHEMA];
