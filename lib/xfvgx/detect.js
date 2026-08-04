// xFVG+ — la détection.
//
// Il n'y en a pas à écrire : un xFVG extra est un xFVG, et le seul détecteur de
// la famille est calcXFVG (lib/xfvg/detect.js). Ce fichier ne fait qu'une chose,
// et c'est justement ce qui justifie qu'il existe : forcer `swing` sur 'extra',
// AU MÊME ENDROIT pour le dessin et pour les positions. Sans lui, les deux
// appelants passeraient l'option chacun de leur côté et rien n'empêcherait le
// graphe de dessiner une famille pendant que le simulateur en joue une autre.
//
// Les zones rendues sont celles du xFVG, avec deux champs qui ne valent jamais
// null ici puisque le motif est défini par eux :
//   swingPrice / swingTime — le niveau du swing cassé, ce que la primitive trace
//     en blanc dans la boîte et ce sur quoi l'ordre attend (cf. ./positions.js).
//   swingIdx — sa bougie.
// Et l'étiquette 'xFVG+', posée par le détecteur pour tout motif qualifié par un
// swing : la liste affichée n'est jamais ambiguë.

import { calcXFVG } from '../xfvg/detect';
import { DETECT_DEFAULTS } from './params';

export function calcXfvgExtra(candles, opts = {}) {
  return calcXFVG(candles, { ...DETECT_DEFAULTS, ...opts, swing: 'extra' });
}
