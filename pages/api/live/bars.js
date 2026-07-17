import { query, exec } from '../../../lib/db';
import { getOrCreateSymbol, ingestAuthorized, validSymbolName } from '../../../lib/ingest';
import { evaluateAlerts } from '../../../lib/notify/evaluate';

// Ingestion de bougies M1 depuis l'EA MT5 (mq5/GrapherFeeder.mq5).
// POST { symbol, bars: [[t, open, high, low, close, tickVol, realVol, spread], …] }
//   t = epoch (s) heure broker — même convention naïve que l'import CSV.
// Crée le symbole si besoin, INSERT OR IGNORE (les doublons sont sans effet,
// l'EA peut donc renvoyer des plages qui se recouvrent sans risque).
// Pas de plafond de bougies par requête : un backfill de plusieurs mois doit
// passer — corps accepté jusqu'à 64 Mo (~1 M de bougies M1), insertion par
// paquets internes pour garder des requêtes SQL raisonnables.
// → { ok, symbolId, received, lastTs }

export const config = { api: { bodyParser: { sizeLimit: '64mb' } } };

const INSERT_BATCH = 10_000;  // lignes par INSERT (interne, aucune limite d'entrée)
const TS_MIN = 946684800;     // 2000-01-01 — garde-fou contre les epochs aberrants
const TS_MAX = 4102444800;    // 2100-01-01

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!ingestAuthorized(req)) return res.status(401).json({ error: 'clé x-ingest-key invalide' });

  const { symbol, bars } = req.body ?? {};
  if (!validSymbolName(symbol)) return res.status(400).json({ error: 'symbol invalide' });
  if (!Array.isArray(bars) || bars.length === 0) return res.status(400).json({ error: 'bars vide' });

  // Validation stricte : 8 nombres finis par bougie. Les valeurs interpolées
  // dans le SQL sont donc garanties numériques (pas d'injection possible).
  const rows = [];
  for (const b of bars) {
    if (!Array.isArray(b) || b.length !== 8) {
      return res.status(400).json({ error: 'format de bougie invalide (8 nombres attendus)' });
    }
    const [t, o, h, l, c, tv, rv, s] = b.map(Number);
    if (![t, o, h, l, c, tv, rv, s].every(Number.isFinite)) {
      return res.status(400).json({ error: 'valeur non numérique dans une bougie' });
    }
    const ts = Math.floor(t);
    if (ts < TS_MIN || ts > TS_MAX) {
      return res.status(400).json({ error: `timestamp hors plage: ${ts}` });
    }
    rows.push({ ts, o, h, l, c, tv: Math.round(tv), rv, s: Math.round(s) });
  }

  try {
    const symbolId = await getOrCreateSymbol(symbol.trim());

    // make_timestamp(µs) crée un TIMESTAMP naïf depuis l'epoch — même convention
    // que l'import CSV (heure broker), indépendant du fuseau de session DuckDB.
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const values = rows.slice(i, i + INSERT_BATCH).map(r =>
        `(${symbolId},make_timestamp(${r.ts * 1000000}),${r.o},${r.h},${r.l},${r.c},${r.tv},${r.rv},${r.s})`
      ).join(',');

      await exec(
        `INSERT OR IGNORE INTO bars_m1 (symbol_id, ts, open, high, low, close, tick_vol, real_vol, spread) VALUES ${values}`
      );
    }

    const [{ last }] = await query(
      'SELECT epoch(max(ts))::BIGINT AS last FROM bars_m1 WHERE symbol_id = ?',
      symbolId,
    );
    const lastTs = Number(last);

    // Évaluation des alertes : délibérément SANS await. L'EA poste toutes les
    // 2 s et ne doit pas attendre un SMTP ou un appel Telegram. La promesse
    // flottante va au bout parce que Next tourne ici en process long-vivant
    // (et non en serverless, où il faudrait un waitUntil).
    evaluateAlerts(symbolId, lastTs).catch(err => console.error('[notify]', err));

    res.json({ ok: true, symbolId, received: rows.length, lastTs });
  } catch (err) {
    console.error('[live/bars]', err);
    res.status(500).json({ error: err.message });
  }
}
