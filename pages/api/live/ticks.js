import { query, exec } from '../../../lib/db';
import { getOrCreateSymbol, ingestAuthorized, validSymbolName } from '../../../lib/ingest';

// Ingestion des TICKS depuis l'EA MT5 (code/mql5/GrapherTicker.mq5).
//
// POST { symbol, ticks: [[tMs, bid, ask, last, volume, flags], …] }
//   tMs    epoch en MILLIsecondes, heure broker — même convention naïve que
//          bars_m1 et l'import CSV, à la milliseconde près (MqlTick.time_msc).
//   bid/ask/last/volume  nombre ou null (null = champ absent pour ce tick).
//   flags  masque MT5 : 2=BID, 4=ASK, 8=LAST, 16=VOLUME, 32=BUY, 64=SELL.
//
// L'EA poste à chaque clôture M1 le lot de ticks de la minute écoulée.
// INSERT OR IGNORE : un lot renvoyé deux fois est sans effet, l'EA peut donc
// retenter sans risque après une coupure.
//
// → { ok, symbolId, received, stored, firstMs, lastMs, symbolLastMs }
//   stored : ticks réellement en base sur la plage du lot APRÈS insertion.
//     stored >= received est la garantie que rien du lot n'a été perdu ; l'EA
//     ne libère son tampon qu'à cette condition.
//
// ── La microseconde qui départage ────────────────────────────────────────────
// La clé primaire de `ticks` est (symbol_id, ts). Or plusieurs ticks tombent
// couramment dans la MÊME milliseconde sur un symbole liquide : stockés tels
// quels, tous sauf un seraient silencieusement jetés par le OR IGNORE — et un
// graphe qui prétend montrer « chaque tick » en perdrait la moitié sans le dire.
// DuckDB stocke les TIMESTAMP à la microseconde : on utilise ces trois chiffres
// libres comme rang du tick dans sa milliseconde (0…999).
//
// L'attribution est déterministe (ordre d'arrivée dans le lot), donc un renvoi
// à l'identique retombe sur les mêmes horodatages et reste idempotent. Au-delà
// de 1000 ticks dans une même milliseconde — jamais vu, ce serait un débit de
// 1 MHz — les surnuméraires écraseraient le rang 999 : ils sont comptés et
// signalés dans `collapsed` plutôt que perdus en silence.
export const config = { api: { bodyParser: { sizeLimit: '32mb' } } };

const INSERT_BATCH = 20_000;     // lignes par INSERT (interne)
const MS_MIN = 946684800000;     // 2000-01-01 — garde-fou contre les epochs aberrants
const MS_MAX = 4102444800000;    // 2100-01-01
const MAX_ORDINAL = 999;

// Nombre fini, ou null si la valeur est absente / non numérique.
function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sqlNum(v) {
  return v == null ? 'NULL' : v;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!ingestAuthorized(req)) return res.status(401).json({ error: 'clé x-ingest-key invalide' });

  const { symbol, ticks } = req.body ?? {};
  if (!validSymbolName(symbol)) return res.status(400).json({ error: 'symbol invalide' });
  if (!Array.isArray(ticks) || ticks.length === 0) return res.status(400).json({ error: 'ticks vide' });

  // Validation stricte : tout ce qui est interpolé dans le SQL plus bas est
  // garanti numérique ici (aucune injection possible).
  const rows = [];
  let collapsed = 0;
  const ordinals = new Map();   // ms → prochain rang libre dans cette milliseconde

  for (const t of ticks) {
    if (!Array.isArray(t) || t.length !== 6) {
      return res.status(400).json({ error: 'format de tick invalide (6 champs attendus)' });
    }
    const ms = Math.floor(Number(t[0]));
    if (!Number.isFinite(ms) || ms < MS_MIN || ms > MS_MAX) {
      return res.status(400).json({ error: `horodatage hors plage: ${t[0]}` });
    }

    const bid = num(t[1]), ask = num(t[2]), last = num(t[3]), vol = num(t[4]);
    const flags = Math.trunc(Number(t[5])) || 0;

    // Un tick sans aucun prix n'apprend rien et fausserait les agrégats.
    if (bid == null && ask == null && last == null) continue;

    const rank = ordinals.get(ms) ?? 0;
    ordinals.set(ms, rank + 1);
    if (rank > MAX_ORDINAL) collapsed++;

    rows.push({
      us: ms * 1000 + Math.min(rank, MAX_ORDINAL),
      bid, ask, last, vol, flags,
    });
  }

  if (rows.length === 0) return res.status(400).json({ error: 'aucun tick exploitable' });

  try {
    const symbolId = await getOrCreateSymbol(symbol.trim());

    // make_timestamp(µs) crée un TIMESTAMP naïf depuis l'epoch — même convention
    // que bars_m1, indépendante du fuseau de session DuckDB.
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const values = rows.slice(i, i + INSERT_BATCH).map(r =>
        `(${symbolId},make_timestamp(${r.us}),${sqlNum(r.bid)},${sqlNum(r.ask)},${sqlNum(r.last)},${sqlNum(r.vol)},${r.flags})`
      ).join(',');

      await exec(
        `INSERT OR IGNORE INTO ticks (symbol_id, ts, bid, ask, last_price, volume, flags) VALUES ${values}`
      );
    }

    // Bornes du lot : boucle et non Math.min(...spread), qui casserait la pile
    // sur un lot de plusieurs dizaines de milliers de ticks.
    let firstUs = rows[0].us, lastUs = rows[0].us;
    for (const r of rows) {
      if (r.us < firstUs) firstUs = r.us;
      if (r.us > lastUs)  lastUs  = r.us;
    }

    // Accusé de réception vérifiable : ce qui est réellement en base sur la
    // plage du lot. L'EA refuse de libérer son tampon si le compte est court.
    const [{ stored }] = await query(
      `SELECT count(*)::BIGINT AS stored FROM ticks
        WHERE symbol_id = ? AND ts BETWEEN make_timestamp(?::BIGINT) AND make_timestamp(?::BIGINT)`,
      symbolId, firstUs, lastUs,
    );

    const [{ last: symLast }] = await query(
      'SELECT epoch_ms(max(ts))::BIGINT AS last FROM ticks WHERE symbol_id = ?',
      symbolId,
    );

    res.json({
      ok: true,
      symbolId,
      received: rows.length,
      stored: Number(stored),
      collapsed,
      firstMs: Math.floor(firstUs / 1000),
      lastMs:  Math.floor(lastUs / 1000),
      symbolLastMs: symLast == null ? null : Number(symLast),
    });
  } catch (err) {
    console.error('[live/ticks]', err);
    res.status(500).json({ error: err.message });
  }
}
