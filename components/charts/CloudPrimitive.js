// LE NUAGE DE LIQUIDITÉ — une bande de prix rendue comme une carte de chaleur.
//
// Écrite pour le $$$, dont la bougie du milieu porte DEUX niveaux : le PIVOT
// (l'arête d'où pendent les deux gaps) et l'EXTRÊME (la pointe, le plus loin où
// le marché est allé). Entre les deux il y a une bande — et un rectangle plat de
// plus n'aurait rien dit de neuf : les deux bords n'ont pas le même statut.
//
// CE QUE LE DESSIN RACONTE, et c'est tout le propos :
//
//   • le bord CHAUD est l'extrême. C'est là que la matière est dense : une arête
//     lumineuse, puis la densité s'effondre vers le pivot. On lit d'un coup
//     d'œil de quel côté la bande « pèse », ce qu'un aplat ne peut pas montrer.
//   • le nuage S'ÉVAPORE VERS LA DROITE. Une zone laissée derrière soi vieillit ;
//     l'opacité décroît avec le temps écoulé plutôt que de s'arrêter net sur un
//     bord vertical arbitraire.
//   • la STRIATION horizontale — des bandes fines et jointives — évoque le
//     carnet d'ordres et donne l'échelle de prix à l'œil, là où un dégradé lisse
//     ne donne aucun repère.
//
// LE PARTI PRIS DE DESSIN : PEU D'ÉLÉMENTS, BIEN POSÉS, ET UNE SEULE COULEUR.
// Tout l'éclat vient de DEUX couches douces superposées — le corps, puis la même
// teinte repassée en additif sur le tiers proche du mur, ce qui la SATURE sans
// la délaver. Aucun mélange vers le blanc, aucun empilement de traits de plus en
// plus épais : le mur est UN filet, pas trois.
// Aucune variation aléatoire : sur une bande de cette taille, le hasard ne fait
// pas « données », il fait sale. Toute la matière vient des courbes, et la
// courbe en S (`doux`) est ce qui sépare une carte de chaleur d'un dégradé de
// tableur.
//
// COMMENT C'EST FAIT : UN dégradé HORIZONTAL par zone (le vieillissement), puis
// N bandes peintes avec, chacune à son opacité propre (le profil de densité).
// Le croisement des deux donne un champ à deux dimensions pour le prix d'un seul
// objet de dégradé — c'est ce qui permet d'en dessiner des dizaines sans que le
// graphe ne rame.
//
// CONTRAT D'UNE ZONE :
//   { side, top, bottom, startTime, endTime, hotEdge }
//   • hotEdge  'top' | 'bottom' — de quel côté se trouve l'extrême, donc le mur.
//   • endTime null → la zone court jusqu'au bord droit du graphe.

const BANDE_PX = 2;      // hauteur visée d'une strie, en pixels logiques
const BANDES_MIN = 6;
const BANDES_MAX = 72;
const HALO = 0.42;       // part de la bande, depuis le mur, que la lueur couvre

// Courbe en S. C'est elle qui fait toute la différence entre « joli » et
// « moche » : une décroissance droite donne un dégradé de logiciel de bureau,
// une puissance nue écrase tout contre le bord. Le S part doucement, plonge au
// milieu, se pose en douceur — l'œil ne trouve nulle part de cassure.
const doux = t => t * t * (3 - 2 * t);

function rgbOf(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// Le trait de mesure est GRIS, et c'est délibéré : il ne dit rien du sens de la
// figure, seulement une distance. Le teinter comme la zone lui donnerait un
// statut qu'il n'a pas.
export const GRIS_MESURE = '148,163,184';

// La distance à la moyenne, écrite lisiblement quel que soit le symbole : un
// indice y bouge de 12 points, une paire de devises de 0,0012. Le nombre de
// décimales suit donc l'ordre de grandeur, et le SIGNE est toujours écrit —
// c'est lui qui porte l'information (la pointe a-t-elle dépassé la moyenne).
export function fmtEcart(v) {
  if (v == null || !Number.isFinite(v)) return null;
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 5;
  return `${v >= 0 ? '+' : '−'}${a.toFixed(d)}`;
}

// ── LE TRAIT DE MESURE ───────────────────────────────────────────────────────
// Une verticale grise qui relie deux prix, COUPÉE EN SON MILIEU pour y loger le
// chiffre. C'est la cote d'un plan technique, et elle est lisible pour la même
// raison : le nombre est DANS la mesure, pas posé à côté. Collé contre une
// extrémité il faudrait suivre le trait des yeux pour savoir ce qu'il mesure.
//
// Grise exprès : elle ne dit rien du sens de la figure, seulement une distance.
// La teinter comme la zone lui donnerait un statut qu'elle n'a pas.
//
// Deux petits tés ferment les extrémités — sans eux le trait paraît s'arrêter au
// hasard au lieu de désigner un niveau. Et si la distance est trop courte pour
// qu'un texte y tienne, on ne coupe pas : le trait reste entier et le chiffre se
// pose à côté.
export function traitDeMesure(ctx, { x, yA, yB, texte, alpha, hr, vr }) {
  const police = Math.round(9.5 * vr);
  const trou   = Math.round(police * 1.7);
  const te     = Math.round(3 * hr);
  const milieu = Math.round((yA + yB) / 2);
  const hauteur = Math.abs(yB - yA);
  const coupe = texte != null && hauteur > trou + 8 * vr;

  ctx.strokeStyle = `rgba(${GRIS_MESURE},${alpha})`;
  ctx.lineWidth = Math.max(1, Math.round(vr));
  ctx.beginPath();
  if (coupe) {
    const haut = Math.min(yA, yB), bas = Math.max(yA, yB);
    ctx.moveTo(x + 0.5, haut);            ctx.lineTo(x + 0.5, milieu - trou / 2);
    ctx.moveTo(x + 0.5, milieu + trou / 2); ctx.lineTo(x + 0.5, bas);
  } else {
    ctx.moveTo(x + 0.5, yA); ctx.lineTo(x + 0.5, yB);
  }
  ctx.moveTo(x + 0.5 - te, yB + 0.5); ctx.lineTo(x + 0.5 + te, yB + 0.5);
  ctx.stroke();

  if (texte == null) return;
  ctx.fillStyle = `rgba(${GRIS_MESURE},${Math.min(1, alpha + 0.35)})`;
  ctx.font = `${police}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = coupe ? 'center' : 'left';
  ctx.fillText(texte, coupe ? x + 0.5 : x + te + Math.round(3 * hr), milieu);
  ctx.textAlign = 'left';
}

// Le VIEILLISSEMENT, en dégradé horizontal. Un seul par zone, partagé par
// toutes les couches. Les arrêts ne sont pas régulièrement espacés : la zone tient franchement sur son
// premier tiers, puis se dissout de plus en plus vite. C'est ce qui lui donne
// une présence là où elle compte, et une disparition qu'on ne voit pas arriver.
function fondu(ctx, x1, x2, teinte, a0) {
  const g = ctx.createLinearGradient(x1, 0, x2, 0);
  g.addColorStop(0,    rgba(teinte, a0));
  g.addColorStop(0.30, rgba(teinte, a0 * 0.82));
  g.addColorStop(0.62, rgba(teinte, a0 * 0.30));
  g.addColorStop(0.86, rgba(teinte, a0 * 0.07));
  g.addColorStop(1,    rgba(teinte, 0));
  return g;
}

class CloudRenderer {
  constructor() { this._data = null; }
  setData(data) { this._data = data; }

  draw(target) {
    const data = this._data;
    if (!data || !data.rects.length) return;

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const fullW = scope.bitmapSize.width;

      for (const r of data.rects) {
        const x1 = Math.round(r.x1 * hr);
        const x2 = r.extendRight ? fullW : Math.round(r.x2 * hr);
        const yTop = Math.round(r.yTop * vr);
        const yBot = Math.round(r.yBottom * vr);
        const w = x2 - x1;
        const h = yBot - yTop;
        if (w <= 0 || h <= 0) continue;

        const base = data.intensity;
        const rgb  = rgbOf(r.color);
        // UNE SEULE TEINTE : celle du sens. L'éclat près du mur vient d'une
        // seconde couche ADDITIVE de la même couleur, qui la sature sans jamais
        // la délaver — pas d'un mélange vers le blanc.
        const grad = fondu(ctx, x1, x2, rgb, 1);

        // ── LE CORPS ─────────────────────────────────────────────────────────
        // Des stries FINES et JOINTIVES — 2 pixels, jusqu'à 72. Assez petites
        // pour que l'œil ne les compte pas, assez présentes pour qu'il sente une
        // échelle de prix. Elles ne portent aucune variation aléatoire : le
        // hasard sur une bande de cette taille ne fait pas « données », il fait
        // sale. Toute la matière vient de la courbe.
        const n = Math.max(BANDES_MIN, Math.min(BANDES_MAX, Math.round(h / (BANDE_PX * vr))));
        const bandeH = h / n;

        ctx.fillStyle = grad;
        for (let s = 0; s < n; s++) {
          const t = n === 1 ? 1 : 1 - s / (n - 1);    // 1 au mur, 0 au froid
          const a = doux(t) * (0.34 + 0.66 * t);      // le S, tiré vers le mur
          if (a < 0.008) continue;
          const y = r.hotTop ? yTop + s * bandeH : yBot - (s + 1) * bandeH;
          ctx.globalAlpha = a * base;
          ctx.fillRect(x1, Math.round(y), w, Math.max(1, Math.ceil(bandeH)));
        }

        // ── LA LUEUR ─────────────────────────────────────────────────────────
        // Le tiers proche du mur, repeint en ADDITIF avec la MÊME couleur. Deux
        // couches douces l'une sur l'autre saturent la teinte et la font
        // rayonner ; c'est de là que vient l'éclat, pas d'un mélange vers le
        // blanc ni d'un empilement de traits de plus en plus épais.
        const nHalo = Math.max(1, Math.round(n * HALO));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        for (let s = 0; s < nHalo; s++) {
          const t = 1 - s / nHalo;
          const a = Math.pow(t, 2.6) * 0.5;
          if (a < 0.006) continue;
          const y = r.hotTop ? yTop + s * bandeH : yBot - (s + 1) * bandeH;
          ctx.globalAlpha = Math.min(1, a * base * 2.4);
          ctx.fillRect(x1, Math.round(y), w, Math.max(1, Math.ceil(bandeH)));
        }

        // ── L'AMORCE ─────────────────────────────────────────────────────────
        // Une verticale sur la bougie d'origine, large de quelques pixels
        // et qui s'éteint aussitôt. Elle ancre le nuage à sa source sans
        // l'alourdir — un halo rond débordait à gauche du départ, ce qui laissait
        // croire que la zone commençait avant la bougie qui la crée.
        const wAm = Math.max(3 * hr, Math.min(w * 0.16, 14 * hr));
        const amorce = ctx.createLinearGradient(x1, 0, x1 + wAm, 0);
        amorce.addColorStop(0, rgba(rgb, 0.5));
        amorce.addColorStop(1, rgba(rgb, 0));
        ctx.globalAlpha = Math.min(1, base * 2.2);
        ctx.fillStyle = amorce;
        ctx.fillRect(x1, yTop, wAm, h);

        // ── LE MUR ───────────────────────────────────────────────────────────
        // Un seul trait, fin et net, posé sur la lueur. C'est la lueur qui fait
        // le halo ; le trait ne fait que lui donner une arête.
        const yMur = r.hotTop ? yTop : yBot;
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1, Math.round(1.5 * vr));
        ctx.globalAlpha = Math.min(1, base * 3.6);
        ctx.beginPath();
        ctx.moveTo(x1, yMur + (r.hotTop ? 0.5 : -0.5));
        ctx.lineTo(x2, yMur + (r.hotTop ? 0.5 : -0.5));
        ctx.stroke();

        // ── LA CONFIRMATION ──────────────────────────────────────────────────
        // Une verticale sur la bougie à la clôture de laquelle la figure est
        // devenue complète. C'est le premier instant où l'on avait le DROIT de
        // voir cette zone : à gauche du repère, le nuage est dessiné sur des
        // bougies qui l'ont précédé. En fractal, l'écart vaut tout un bucket HTF
        // — sans le repère on croirait la zone connue quinze bougies trop tôt.
        // Un cran qui déborde des deux côtés de la bande, pour rester visible
        // même sur un nuage écrasé.
        if (r.xConfirm != null) {
          const xc = Math.round(r.xConfirm * hr);
          if (xc >= x1 && xc <= x2) {
            const deb = Math.round(4 * vr);
            ctx.strokeStyle = grad;
            ctx.lineWidth = Math.max(1, Math.round(1.5 * hr));
            ctx.globalAlpha = Math.min(1, base * 3.2);
            ctx.beginPath();
            ctx.moveTo(xc + 0.5, yTop - deb);
            ctx.lineTo(xc + 0.5, yBot + deb);
            ctx.stroke();
          }
        }

        ctx.globalCompositeOperation = 'source-over';

        // ── L'ARÊTE FROIDE ───────────────────────────────────────────────────
        // Le pivot : un filet continu et discret. Le pointillé faisait bon
        // marché à cette échelle, et attirait l'œil sur le bord le moins
        // important des deux.
        const yFroid = r.hotTop ? yBot : yTop;
        ctx.strokeStyle = grad;
        ctx.globalAlpha = Math.min(1, base * 1.9);
        ctx.lineWidth = Math.max(1, Math.round(vr));
        ctx.beginPath();
        ctx.moveTo(x1, yFroid + (r.hotTop ? -0.5 : 0.5));
        ctx.lineTo(x2, yFroid + (r.hotTop ? -0.5 : 0.5));
        ctx.stroke();

        ctx.globalAlpha = 1;

        // ── LE TRAIT DE MESURE ───────────────────────────────────────────────
        // Une fine verticale grise qui relie la pointe à la moyenne, sur la
        // bougie où la mesure est prise. Elle donne au chiffre ce qu'un chiffre
        // seul ne peut pas avoir : de quoi juger la distance à l'œil, et voir de
        // quel côté de la moyenne la pointe est allée. Gris exprès — elle ne
        // porte pas le sens de la figure, seulement un écart.
        if (r.yMa != null) {
          traitDeMesure(ctx, {
            x: x1, yA: yMur, yB: Math.round(r.yMa * vr),
            texte: data.showLabel ? r.ecart : null,
            alpha: Math.min(1, base * 3.4), hr, vr,
          });
        }

        // L'étiquette se pose HORS de la bande, du côté du mur : posée dedans
        // elle se battait avec la lueur, et il n'y a pas de fond assez sombre
        // sous un nuage pour qu'un texte y reste lisible.
        if (data.showLabel && r.label) {
          ctx.fillStyle = rgba(rgb, Math.min(1, base * 3.6));
          ctx.font = `${Math.round(9.5 * vr)}px Inter, system-ui, sans-serif`;
          ctx.textBaseline = r.hotTop ? 'bottom' : 'top';
          ctx.fillText(r.label, x1 + Math.round(3 * hr),
                       r.hotTop ? yTop - Math.round(4 * vr) : yBot + Math.round(4 * vr));
        }
      }
    });
  }
}

class CloudPaneView {
  constructor(source) {
    this._source = source;
    this._renderer = new CloudRenderer();
  }

  zOrder() { return 'bottom'; }   // derrière les bougies : c'est un fond, pas un objet

  update() {
    const { _chart: chart, _series: series, _zones: zones, _opts: opts } = this._source;
    if (!chart || !series) { this._renderer.setData(null); return; }

    const ts = chart.timeScale();
    const rects = [];
    const montreMesure = opts.showMaDist !== false;

    for (const z of zones) {
      const x1 = ts.timeToCoordinate(z.startTime);
      const yTop = series.priceToCoordinate(z.top);
      const yBottom = series.priceToCoordinate(z.bottom);
      if (x1 == null || yTop == null || yBottom == null) continue;

      const extendRight = z.endTime == null;
      const x2 = extendRight ? null : ts.timeToCoordinate(z.endTime);
      if (!extendRight && x2 == null) continue;

      // La bougie qui CONFIRME la figure. En fractal elle tombe bien après le
      // début du nuage — le bucket HTF met quinze bougies M1 à se fermer —, et
      // c'est justement ce décalage qu'il faut voir : avant elle, la zone
      // n'existait pas encore.
      const xc = z.confirmTime != null ? ts.timeToCoordinate(z.confirmTime) : null;

      rects.push({
        x1, x2, extendRight, yTop, yBottom,
        color: z.side === 'bull' ? opts.bullColor : opts.bearColor,
        hotTop: z.hotEdge !== 'bottom',
        // QUAND IL Y A UNE MESURE, ELLE REMPLACE LE NOM DU MOTIF, et elle
        // s'écrit AU MILIEU du trait de mesure — pas contre le mur. Écrire
        // « $$$ » à côté d'un nombre n'apprend rien : la couleur et la forme
        // disent déjà de quel motif il s'agit.
        // Masquer la mesure rend au motif son étiquette : sinon la zone se
        // retrouverait sans rien d'écrit du tout.
        ecart: montreMesure ? fmtEcart(z.maDist) : null,
        label: montreMesure && z.maDist != null ? null : (z.label ?? opts.labelText),
        xConfirm: xc,
        // Le prix de la moyenne, pour relier les deux points d'un trait.
        yMa: montreMesure && z.maValue != null ? series.priceToCoordinate(z.maValue) : null,
      });
    }

    this._renderer.setData({
      rects,
      // L'opacité du panneau sert de MAÎTRE : elle plafonne le nuage entier, de
      // sorte que le même curseur règle les boîtes et lui.
      intensity: Math.min(1, (opts.opacity ?? 0.18) * 2.6),
      showLabel: opts.showLabel,
    });
  }

  renderer() { return this._renderer; }
}

class CloudPrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._zones = [];
    this._opts = { bullColor: '#26A69A', bearColor: '#EF5350', opacity: 0.18, showLabel: true, labelText: '$$$' };
    this._paneViews = [new CloudPaneView(this)];
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  update(zones, opts) {
    this._zones = zones ?? [];
    this._opts = { ...this._opts, ...opts };
    this._requestUpdate?.();
  }

  updateAllViews() {
    for (const v of this._paneViews) v.update();
  }

  paneViews() { return this._paneViews; }
}

export function createCloudPrimitive() {
  return new CloudPrimitive();
}
