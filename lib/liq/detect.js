// liq — la pince : deux impulsions opposées séparées par une respiration.
//
// CE QUE C'EST, et ce que ce n'est pas. Le xFVG cherche un DÉSÉQUILIBRE : deux
// bougies qui ne se touchent pas de part et d'autre d'une impulsion. Ici, aucun
// gap n'est exigé — c'est la seule chose qu'on abandonne, et c'est ce qui fait
// de ce motif une famille à part plutôt qu'une option du xFVG. La figure :
//
//     impulsion ↑ · respiration · respiration · … · impulsion ↓     (et le miroir)
//
//   • les deux IMPULSIONS sont de sens opposés et répondent chacune à la même
//     condition de taille (large vs ATR) ;
//   • entre elles, de 1 à `maxBars`−1 bougies qui répondent TOUTES à la condition
//     de respiration — une seule bougie qui reprend la main rompt la chaîne ;
//   • les deux impulsions sont à au plus `maxBars` barres l'une de l'autre ;
//   • à la PREMIÈRE impulsion opposée rencontrée, la pince se ferme : c'est la
//     plus serrée qui compte, pas la plus spectaculaire.
//
// Aucune condition de PRIX : deux impulsions opposées proches dans le temps
// suffisent, même à des prix éloignés.
//
// LE MARQUAGE — un NIVEAU, pas une zone. Ce qui compte n'est pas la surface
// balayée mais le prix extrême atteint pendant la respiration, là où le marché
// s'est arrêté avant de repartir :
//
//   liq HAUSSIER (la seconde impulsion monte) → le plus HAUT des respirations
//   liq BAISSIER (la seconde impulsion baisse) → le plus BAS des respirations
//
// Les deux grandes bougies sont exclues du calcul : ce sont elles qui bornent la
// figure, pas elles qui la marquent. Le niveau est donc toujours pris sur les
// seules bougies du milieu — au moins une existe, la figure l'exige.
//
// Chaque figure : { side, state: 'active', label: 'liq', idx, level, top, bottom,
//                   startTime, endTime, fromIdx, toIdx, breathCount }
//   side        — le sens de la SECONDE impulsion, celle qui retourne le marché.
//                 C'est lui qui décide du haut ou du bas, et de la couleur.
//   level       — le prix marqué, au centre de la bande.
//   top/bottom  — la BANDE, haute de `zonePts` POINTS de prix au total, centrée
//                 sur le niveau. C'est elle qu'on dessine, et c'est dans elle que
//                 le prix doit revenir pour qu'une position soit prise.
//   idx         — l'index de la seconde impulsion : la figure n'est connue que
//                 là, et c'est ce qui la situe dans le temps.

import { atrArr, bbArr } from '../patterns';
import {
  impulseIsLarge, breathIsSmall, breathHasWick,
  usesImpulseSize, usesBreathSize, usesBreathWick,
} from '../candleRules';
import { DETECT_DEFAULTS } from './params';

export function calcLiq(candles, opts = {}) {
  const p = { ...DETECT_DEFAULTS, ...opts };
  const out = [];
  const n = candles?.length ?? 0;
  if (n < 3 || !(p.maxBars >= 2)) return out;

  const useSize  = usesImpulseSize(p);
  const useSmall = usesBreathSize(p);
  const useWick  = usesBreathWick(p);
  const atr = (useSize || useSmall) ? atrArr(candles, p.atrPeriod) : null;

  const useBB = p.bbFilter === true && p.bbPeriod >= 2;
  const bb    = useBB ? bbArr(candles, p.bbPeriod, p.bbDev) : null;

  // Le filtre des bandes : la pince doit s'être formée à l'EXTÉRIEUR de la bande,
  // du côté que son retournement suppose — une pince haussière sous la bande
  // basse (le marché est allé chercher loin en dessous avant de se retourner),
  // une baissière au-dessus de la bande haute. Les deux IMPULSIONS sont jugées,
  // pas les respirations : ce sont elles qui portent le mouvement.
  //
  // « Complètement » se prend au pied de la lettre : mèches comprises. Le plus
  // haut de l'impulsion doit rester sous la bande basse, son plus bas au-dessus
  // de la bande haute. Rien de la bougie ne dépasse.
  //
  // Tant que la bande n'est pas calculable (préchauffage de `bbPeriod` barres),
  // la pince est écartée : on ne devine pas où était la bande.
  const outsideBand = (k, dir) => {
    if (dir === 'bull') {
      const lo = bb.lower[k];
      return lo != null && candles[k].high < lo;
    }
    const up = bb.upper[k];
    return up != null && candles[k].low > up;
  };

  // Une impulsion ? Rend 'bull' / 'bear' / null — le sens sert ensuite à chercher
  // l'opposé, autant le renvoyer plutôt que de le recalculer.
  const impulse = k => {
    const m = candles[k];
    const dir = m.close > m.open ? 'bull' : m.close < m.open ? 'bear' : null;
    if (!dir) return null;                       // un doji ne pousse rien
    if (useSize && !impulseIsLarge({ atr, i: k, m }, p)) return null;
    return dir;
  };

  // Une respiration ? L'ATR est lu sur la bougie qui la précède (k−1). `isBull`
  // est le sens de la PREMIÈRE impulsion : la mèche de rejet se juge par rapport
  // au mouvement dont on respire.
  const breath = (k, isBull) => {
    const x = { atr, i: k - 1, c: candles[k], isBull };
    if (useSmall && !breathIsSmall(x, p)) return false;
    if (useWick  && !breathHasWick(x))    return false;
    return true;
  };

  for (let a = 1; a < n - 2; a++) {
    const dirA = impulse(a);
    if (!dirA) continue;
    const isBullA = dirA === 'bull';

    // On avance bougie par bougie. La chaîne de respiration doit tenir jusqu'à
    // l'impulsion opposée : la première bougie qui n'est ni l'une ni l'autre met
    // fin à la recherche pour ce départ.
    for (let k = a + 1; k < n && k - a <= p.maxBars; k++) {
      const dirB = impulse(k);

      // Impulsion opposée, et au moins une respiration derrière soi.
      if (dirB && dirB !== dirA && k - a >= 2) {
        const passeBandes = !useBB || (outsideBand(a, dirB) && outsideBand(k, dirB));

        if ((p.direction === 'both' || p.direction === dirB) && passeBandes) {
          // Le niveau : l'extrême des SEULES bougies du milieu, du côté que le
          // retournement désigne. Les deux impulsions sont exclues — elles
          // bornent la figure, elles ne la marquent pas.
          let level = dirB === 'bull' ? -Infinity : Infinity;
          for (let j = a + 1; j < k; j++) {
            level = dirB === 'bull'
              ? Math.max(level, candles[j].high)
              : Math.min(level, candles[j].low);
          }

          // Le trait couvre la figure — la seconde impulsion COMPRISE, les
          // coordonnées visant le centre d'une bougie —, puis se prolonge de
          // `extBars` barres. C'est ce prolongement qui rend le niveau lisible :
          // sans lui le trait ne dure que le temps de la pince.
          const endIdx = Math.min(k + 1 + p.extBars, n - 1);

          // La bande, CENTRÉE sur le niveau : `zonePts` points de hauteur au
          // total, moitié au-dessus, moitié en dessous. Une seule définition,
          // partagée par le dessin (LevelPrimitive) et par l'entrée
          // (./positions.js) : la zone testée doit être celle qu'on voit, au
          // point près.
          const half = p.zonePts / 2;

          out.push({
            side:        dirB,
            state:       'active',
            label:       'liq',
            idx:         k,
            level,
            top:         level + half,
            bottom:      level - half,
            startTime:   candles[a].time,
            endTime:     candles[endIdx].time,
            fromIdx:     a,
            toIdx:       k,
            breathCount: k - a - 1,
          });
        }
        // La pince se ferme ici, retenue ou écartée par les filtres : au-delà, la
        // respiration serait de toute façon interrompue par cette impulsion.
        break;
      }

      if (!breath(k, isBullA)) break;
    }
  }

  return out;
}
