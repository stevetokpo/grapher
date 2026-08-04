import { query } from '../../lib/db';
import { getResolution, isTickResolution, sourceExpr } from '../../lib/ticker/resolutions';

// Lecture du ticker. Une seule source pour toute la page : la table `ticks`.
// Les bougies de 1 s à 1 min sont agrégées à la volée, exactement comme
// /api/bars agrège les timeframes longs depuis bars_m1 — rien n'est pré-calculé,
// changer de pas de temps ne demande donc aucune reconstruction.
//
// GET /api/ticks?symbolId=1&res=5s&src=mid&limit=1500[&from=&to=&toUs=&fromUs=]
//
//   res    'tick' | '1s' … '1m'   (lib/ticker/resolutions.js)
//   src    'bid' | 'ask' | 'mid' | 'last' — ignoré en mode 'tick', qui renvoie
//          les colonnes brutes et laisse le graphe choisir ce qu'il trace.
//   from   borne basse INCLUSIVE, en millisecondes epoch (heure broker)
//   to     borne haute EXCLUSIVE, en millisecondes — c'est le curseur de
//          pagination arrière : on redemande toujours les N plus RÉCENTS avant
//          ce point, puis on renvoie en ordre croissant.
//   fromUs / toUs  mêmes bornes en MICROsecondes. Elles priment quand elles
//          sont présentes : en mode tick, plusieurs points partagent la même
//          milliseconde (voir /api/live/ticks), et un curseur à la milliseconde
//          rejetterait ou dupliquerait les voisins de la frontière de page.
//
// Réponse mode 'tick'     : { res, src, rows: [{ us, t, bid, ask, last, vol, flags }, …] }
// Réponse mode agrégé     : { res, src, rows: [{ time, open, high, low, close, ticks, vol, spread }, …] }
// Dans les deux cas `rows` est trié par temps CROISSANT.

const TICK_LIMIT_DEFAULT = 20_000;
const TICK_LIMIT_MAX     = 50_000;
const BAR_LIMIT_DEFAULT  = 1_500;
const BAR_LIMIT_MAX      = 20_000;

// Bornes temporelles → fragment WHERE. Les valeurs sont passées au filtre
// Number() puis tronquées : rien de non numérique n'atteint le SQL.
function buildRange({ from, to, fromUs, toUs }) {
  const parts = [];
  const lowUs  = firstFinite(fromUs, from == null ? null : from * 1000);
  const highUs = firstFinite(toUs,   to   == null ? null : to   * 1000);

  if (lowUs  != null) parts.push(`ts >= make_timestamp(${Math.trunc(lowUs)})`);
  if (highUs != null) parts.push(`ts <  make_timestamp(${Math.trunc(highUs)})`);
  return parts;
}

function firstFinite(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, res: resId = '1s', src = 'mid', limit, from, to, fromUs, toUs } = req.query;

  if (!symbolId) return res.status(400).json({ error: 'symbolId requis' });
  const id = parseInt(symbolId, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'symbolId invalide' });

  const resolution = getResolution(resId);
  if (!resolution) return res.status(400).json({ error: `pas de temps inconnu: ${resId}` });

  const range = buildRange({ from, to, fromUs, toUs });
  const where = [`symbol_id = ${id}`, ...range];

  try {
    if (isTickResolution(resId)) {
      const n = clamp(limit, TICK_LIMIT_DEFAULT, TICK_LIMIT_MAX);
      // On prend les N plus RÉCENTS de la fenêtre (ORDER BY ts DESC), puis on
      // remet dans l'ordre : c'est la dernière page qui intéresse à l'ouverture,
      // et la pagination arrière recule ensuite avec `toUs`.
      const rows = await query(`
        SELECT * FROM (
          SELECT
            epoch_us(ts)::BIGINT AS us,
            bid, ask,
            last_price AS last,
            volume     AS vol,
            flags
          FROM ticks
          WHERE ${where.join(' AND ')}
          ORDER BY ts DESC
          LIMIT ${n}
        ) ORDER BY us ASC
      `);

      return res.json({
        res: resId,
        src,
        rows: rows.map(r => ({
          us:    Number(r.us),
          t:     Math.floor(Number(r.us) / 1000),
          bid:   r.bid  == null ? null : Number(r.bid),
          ask:   r.ask  == null ? null : Number(r.ask),
          last:  r.last == null ? null : Number(r.last),
          vol:   r.vol  == null ? null : Number(r.vol),
          flags: Number(r.flags ?? 0),
        })),
      });
    }

    // ── Agrégation ───────────────────────────────────────────────────────────
    const price = sourceExpr(src);
    if (!price) return res.status(400).json({ error: `source de prix inconnue: ${src}` });

    const n   = clamp(limit, BAR_LIMIT_DEFAULT, BAR_LIMIT_MAX);
    const sec = resolution.sec;

    // Seau = (epoch_ms // largeur_ms) * largeur_s. Division ENTIÈRE (`//`) sur
    // des BIGINT : exacte, contrairement à un floor() en virgule flottante.
    // Tous les pas divisent 86 400 s, donc les seaux retombent sur minuit quel
    // que soit le pas — aucune origine à préciser.
    const bucket = `((epoch_ms(ts) // ${sec * 1000}) * ${sec})::BIGINT`;

    // Le prix retenu doit exister : un tick LAST-seul n'a pas de cotation, un
    // instrument synthétique n'a jamais de LAST. Les lignes sans prix sur la
    // source demandée sortent avant l'agrégation, sinon elles créeraient des
    // bougies vides aux mêmes horodatages que les vraies.
    const rows = await query(`
      SELECT * FROM (
        SELECT
          ${bucket}                       AS time,
          arg_min(${price}, ts)::DOUBLE   AS open,
          max(${price})::DOUBLE           AS high,
          min(${price})::DOUBLE           AS low,
          arg_max(${price}, ts)::DOUBLE   AS close,
          count(*)::INTEGER               AS ticks,
          coalesce(sum(volume), 0)::DOUBLE AS vol,
          avg(ask - bid)::DOUBLE          AS spread
        FROM ticks
        WHERE ${where.join(' AND ')} AND ${price} IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT ${n}
      ) ORDER BY time ASC
    `);

    res.json({
      res: resId,
      src,
      rows: rows.map(r => ({
        time:   Number(r.time),
        open:   Number(r.open),
        high:   Number(r.high),
        low:    Number(r.low),
        close:  Number(r.close),
        ticks:  Number(r.ticks),
        vol:    Number(r.vol),
        spread: r.spread == null ? null : Number(r.spread),
      })),
    });
  } catch (err) {
    console.error('[ticks]', err);
    res.status(500).json({ error: err.message });
  }
}

function clamp(raw, dflt, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(1, Math.min(max, n));
}
