// MISE EN FORME DES CHIFFRES D'UN RAPPORT DE POSITIONS.
//
// Extrait de pages/rapports.js quand une deuxième vue (la carte Monte-Carlo) a
// eu besoin des mêmes formats : deux jeux de formateurs auraient fini par écrire
// « 194 027.65 $ » d'un côté et « 194027.7 $ » de l'autre pour le même nombre,
// dans la même page.
//
// LA RÈGLE DE LA PAGE, qu'ils servent : le rapport ne contient QUE des points ;
// le prix du point les convertit à l'affichage seulement.
//   • en $  : tout ce qui est un RÉSULTAT — espérance, net, drawdown, ruine ;
//   • en pts : tout ce qui est une DISTANCE DE PRIX — risque, TP, excursion,
//     déclencheur de break-even. Ces chiffres-là se reportent tels quels dans
//     les panneaux de réglage, les convertir les rendrait inutiles.

// Espaces INSÉCABLES, fine pour les milliers et normale devant le $ : avec des
// espaces ordinaires, « +194 027.65 $ » se coupe en deux lignes au milieu du
// nombre dans une tuile étroite, et on lit 194 là où il y a 194 027.
const THIN = ' ', NBSP = ' ';

export const group = s => s.replace(/\B(?=(\d{3})+$)/g, THIN);

// Les cents tombent au-delà du millier : sur un total à six chiffres ils ne
// disent rien et c'est la seule façon de tenir dans la tuile.
export const money = v => {
  const a = Math.abs(v);
  const [i, f] = a.toFixed(a >= 1000 ? 0 : 2).split('.');
  return f ? `${group(i)}.${f}` : group(i);
};

// Signé (un résultat : le signe est l'information) et non signé (un montant dont
// le sens est déjà dit par le libellé, « Drawdown max » par exemple). Sous le
// demi-cent, le signe est jeté : « −0.00 $ » se lit comme une perte alors que
// c'est un zéro arrondi.
export const fmtUsd = v => v == null ? '—' : `${v >= -0.005 ? '+' : '−'}${money(v)}${NBSP}$`;
export const fmtAbs = v => v == null ? '—' : `${money(v)}${NBSP}$`;

// Le TAUX lui-même, qui peut être bien plus fin qu'un cent (un point à 0.001 $
// n'est pas rare sur un indice) : deux décimales l'afficheraient « 0.00 $ ».
export const fmtRate = v => v !== 0 && Math.abs(v) < 0.01 ? String(+v.toPrecision(3)) : money(v);

// Les DISTANCES restent en points. Même groupement des milliers que les
// montants — les deux se côtoient dans un sous-titre, un « 38805.5 » à côté d'un
// « 194 028 » se lit deux fois.
export const fmtP = v => {
  if (v == null) return '—';
  const [i, f] = Math.abs(v).toFixed(1).split('.');
  return `${v >= 0 ? '+' : '−'}${group(i)}.${f}${NBSP}pts`;
};

// Graduations d'une courbe : au-delà du millier on abrège, sinon l'étiquette
// mange la marge de gauche.
export const fmtTick = v => {
  const a = Math.abs(v);
  if (a >= 10000) return `${v < 0 ? '−' : ''}${(a / 1000).toFixed(0)}k`;
  if (a >= 1000)  return `${v < 0 ? '−' : ''}${(a / 1000).toFixed(1)}k`;
  return group(String(Math.round(v))).replace('-', '−');
};

export const fmtPct = v => v == null ? '—' : `${(v * 100).toFixed(1)} %`;
export const fmtNum = (v, d = 2) => v == null ? '—' : v.toFixed(d);

// Facteur de profit : ∞ quand il n'y a aucune perte — le dire plutôt que le taire.
export const fmtPF = v => v == null ? '—' : (Number.isFinite(v) ? v.toFixed(2) : '∞');

export const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};
