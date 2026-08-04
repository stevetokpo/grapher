// L'ARDOISE — l'arithmétique du dû, et rien d'autre.
//
// TROIS simulateurs jouent le dû : lib/patternPositions.js (la famille liq /
// rev / Twins Bars), lib/signals/engine.js (le rFVG et le KO côté serveur) et
// calcRFVGPositions (lib/patterns.js, le rFVG du graphe). Ils n'ont ni les mêmes
// entrées, ni les mêmes stops, ni les mêmes objectifs — mais la file des pertes
// non remboursées, elle, doit être la MÊME partout : sans quoi « seuil 8 » ne
// veut pas dire la même chose d'un motif à l'autre, et deux résultats cessent
// d'être comparables. C'est la raison d'être de ce fichier : un seul endroit où
// une perte entre dans l'ardoise, un seul endroit où un gain la rembourse.
//
// CE QUE LE REGISTRE NE FAIT PAS : il ne connaît ni prix, ni bougies, ni TP. Il
// rend une DISTANCE en points ; c'est au simulateur de décider ce qu'il en fait —
// et tous en font la même chose, l'objectif de la position.
//
// LA RÈGLE :
//   • toute position clôturée dans le rouge laisse sa perte NETTE dans la file,
//     de la plus ancienne à la plus récente ;
//   • tout gain rembourse la file en commençant par la plus ANCIENNE ; ce qu'il
//     ne couvre pas entièrement reste dû, à hauteur du reliquat ;
//   • dès que la file atteint `threshold` pertes, le dû est ARMÉ : la position
//     suivante vise le remboursement au lieu de son vrai TP — et elle le vise
//     même si c'est plus PRÈS que son objectif normal, parce que rembourser
//     passe avant.
//
// COMBIEN ON VISE (`mode`) :
//   'full' — TOUTE l'ardoise d'un coup. Plus elle a grossi, plus l'objectif est
//     loin : au bout d'une longue série il peut devenir hors d'atteinte, et un
//     objectif qu'on n'atteint pas ne rembourse rien du tout.
//   'step' — PAR BONDS de `threshold` fois la perte MOYENNE encore due. C'est
//     exactement l'ardoise au moment où le dû s'arme (la file compte alors
//     `threshold` pertes) et une FRACTION d'elle dès qu'elle a grossi :
//     l'objectif garde la taille de ce qui a armé le dû au lieu de fuir avec
//     lui. Le bond ne dépasse jamais l'ardoise — la file compte au moins
//     `threshold` pertes, donc seuil × moyenne ≤ somme.
//
// « PERTE » SE JUGE AU NET, pas au statut : une sortie au break-even qui finit
// sous zéro (le spread) est une perte et compte dans le seuil comme un SL. Un
// résultat exactement nul ne compte ni d'un côté ni de l'autre.
//
// ANTI-ANTICIPATION — c'est tout l'objet de `settle`. Les positions se
// chevauchant (sauf en trade unique), une position peut sortir APRÈS l'entrée de
// la suivante : son résultat ne pouvait pas être connu au moment de poser
// l'ordre, il ne doit donc pas peser sur le dû de cette entrée-là. Les sorties
// sont donc mises en attente et ne rejoignent l'ardoise qu'au premier `settle`
// dont la bougie leur est postérieure. Conséquence assumée : le dû lu par une
// position peut être plus petit que l'ardoise réelle au même instant.
//
// LE BREAK-EVEN N'EST PAS CONCERNÉ, et c'est une règle de la maison : le dû
// déplace l'OBJECTIF, jamais la protection. Le seuil et le niveau du BE se
// règlent sur le risque (famille des motifs) ou sur le TP normal de la position
// (moteur partagé), jamais sur l'ardoise — sans quoi un même réglage de BE
// protégerait différemment selon ce qu'on doit, et une longue série de pertes
// désarmerait silencieusement le break-even.

export function createDueLedger({ threshold = 0, mode = 'full' } = {}) {
  const on = threshold > 0;
  // La file elle-même : les pertes NON REMBOURSÉES, en points, de la plus
  // ancienne à la plus récente. Le seuil, c'est sa longueur ; le dû, c'est sa
  // somme — les deux tombent d'eux-mêmes, sans compteur tenu à part.
  const queue = [];
  // Les sorties CONNUES mais pas encore prises en compte (cf. anti-anticipation).
  let pending = [];

  // Fait entrer dans l'ardoise tout ce qui s'est clôturé AVANT la bougie
  // `untilIdx`, dans l'ordre des sorties. Une sortie sur la bougie d'entrée
  // elle-même ne compte pas : à l'ouverture, elle n'avait pas encore eu lieu.
  const settle = untilIdx => {
    if (!on || !pending.length) return;
    const prets = [], reste = [];
    for (const e of pending) (e.exitIdx < untilIdx ? prets : reste).push(e);
    if (!prets.length) return;
    pending = reste;
    prets.sort((a, b) => a.exitIdx - b.exitIdx);
    for (const e of prets) {
      if (e.net < 0) { queue.push(-e.net); continue; }
      // Un gain rembourse les pertes les plus ANCIENNES d'abord. Ce qu'il ne
      // couvre pas entièrement reste dû, à hauteur du reliquat : la perte n'a
      // pas disparu, elle a seulement diminué.
      let gain = e.net;
      while (gain > 0 && queue.length) {
        if (queue[0] > gain) { queue[0] -= gain; gain = 0; }
        else                 { gain -= queue.shift(); }
      }
    }
  };

  return {
    on,
    settle,

    // Ce que la position qui entre MAINTENANT doit viser. `duePts` = 0 : le dû
    // n'est pas armé, elle joue son vrai TP. Se lit à l'entrée et ne bouge plus :
    // les pertes qui s'ajouteront pendant sa vie iront dans le dû de la suivante.
    target() {
      const armed = on && queue.length >= threshold;
      if (!armed) return { duePts: 0, dueTotalPts: 0, dueCount: 0 };
      const total = queue.reduce((s, v) => s + v, 0);
      return {
        duePts:      mode === 'step' ? threshold * (total / queue.length) : total,
        dueTotalPts: total,
        dueCount:    queue.length,
      };
    },

    // Le résultat d'une position RETENUE. Une position encore ouverte au bord
    // des données n'a rien réalisé : elle n'est pas enregistrée, et un signal
    // simulé à blanc (sauté par le repos) non plus — il n'a jamais été pris.
    record(exitIdx, net) {
      if (on) pending.push({ exitIdx, net });
    },

    // Ce qui reste à devoir. À lire APRÈS un dernier `settle(Infinity)`, sans
    // quoi le reliquat oublierait les dernières positions closes, qu'aucune
    // entrée suivante n'est venue lire.
    remaining() {
      return { pts: queue.reduce((s, v) => s + v, 0), count: queue.length };
    },
  };
}
