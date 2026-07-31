// /api/ko/configs — les réglages KO retenus par symbole (table `ko_configs`,
// cf. lib/db.js).
//
//   GET                     → toutes les lignes, symbole résolu
//   POST                    → crée ou remplace (clé : symbol_id + tf + name)
//   DELETE ?id=…            → supprime
//
// L'écriture passe par le même `sanitize` que les runs : une config enregistrée
// est donc, par construction, exactement celle qui a été simulée — pas une
// variante approchée saisie à la main dans le formulaire.
//
// `nullCheck` (verdict du contrôle par décalage circulaire) est stocké à part de
// `metrics` parce qu'il répond à une autre question : metrics dit COMBIEN la
// configuration a gagné, nullCheck dit si ce gain se distingue de ce que
// n'importe quelle date d'entrée aurait donné. Le KO autorisant le balayage de la
// détection, la seconde question n'est pas facultative.

import { query, run } from '../../../lib/db';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/ko/params';

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const rows = await query(`
        SELECT c.id, c.symbol_id, s.name AS symbol, c.tf, c.name, c.detect, c.exit_params,
               c.fills, c.spread_pts, c.status, c.metrics, c.null_check, c.notes,
               c.created_at::VARCHAR AS created_at, c.updated_at::VARCHAR AS updated_at
        FROM ko_configs c
        LEFT JOIN symbols s ON s.id = c.symbol_id
        ORDER BY s.name, c.tf, c.name
      `);
      return res.json(rows.map(r => ({
        id: Number(r.id), symbolId: Number(r.symbol_id), symbol: r.symbol, tf: r.tf, name: r.name,
        detect: parse(r.detect, {}), exit: parse(r.exit_params, {}),
        fills: r.fills, spreadPoints: Number(r.spread_pts),
        status: r.status, metrics: parse(r.metrics, null), nullCheck: parse(r.null_check, null),
        notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at,
      })));
    }

    if (req.method === 'POST') {
      const b = req.body ?? {};
      const symbolId = Number(b.symbolId);
      if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });
      const tf   = b.tf ?? '15m';
      const name = (b.name ?? 'base').trim() || 'base';

      const det = sanitize(DETECT_SCHEMA, b.detect ?? {});
      const ex  = sanitize(EXIT_SCHEMA,   b.exit   ?? {});
      const fills  = b.fills === 'm1' ? 'm1' : 'bar';
      const spread = Number(b.spreadPoints) || 0;
      const status = ['draft', 'validated', 'rejected'].includes(b.status) ? b.status : 'draft';

      // Remplacement explicite : DuckDB n'a pas d'UPSERT sur contrainte UNIQUE
      // aussi confortable que le ON CONFLICT de Postgres, et un DELETE + INSERT
      // dit franchement ce qui se passe — la ligne précédente est écrasée.
      await run(`DELETE FROM ko_configs WHERE symbol_id = ? AND tf = ? AND name = ?`,
        symbolId, tf, name);
      await run(`
        INSERT INTO ko_configs
          (id, symbol_id, tf, name, detect, exit_params, fills, spread_pts, status,
           metrics, null_check, notes, updated_at)
        VALUES (nextval('seq_ko_configs'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
      `, symbolId, tf, name,
         JSON.stringify(det.params), JSON.stringify(ex.params),
         fills, spread, status,
         b.metrics   ? JSON.stringify(b.metrics)   : null,
         b.nullCheck ? JSON.stringify(b.nullCheck) : null,
         b.notes ?? null);

      return res.json({ ok: true, clamped: [...det.clamped, ...ex.clamped] });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'id requis' });
      await run(`DELETE FROM ko_configs WHERE id = ?`, id);
      return res.json({ ok: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('[ko/configs]', err);
    res.status(500).json({ error: err.message });
  }
}
