// GET /api/htf — série d'une unité de temps supérieure, indépendamment de ce
// que le graphe a chargé.
//
// Raison d'être : sur TradingView, request.security va chercher l'historique HTF
// de son côté. Ici les bougies du graphe sont paginées (500 par page) et une
// Bollinger 50 en H16 réclame ~34 jours d'historique — la reconstruire depuis
// les bougies affichées la laisserait muette. Cet endpoint sert la série HTF
// directement, et elle est minuscule (51 bougies suffisent).
//
//   symbolId  obligatoire
//   sec       taille du bucket en secondes (3600 = H1, 57600 = H16…)
//   off       décalage d'alignement du bucket (W1 : 345600, aligné sur lundi)
//   to        borne SUPÉRIEURE EXCLUSIVE, en epoch secondes. Le replay la fixe
//             au curseur : aucune bougie postérieure ne peut fuir dans le calcul.
//   from      borne INFÉRIEURE INCLUSIVE, en epoch secondes (optionnelle). C'est
//             elle qui borne le travail de la base : la fenêtre du graphe plus
//             son préchauffage, rien de plus.
//   limit     nombre de bougies HTF, les plus récentes. Garde-fou, pas cadrage :
//             l'appelant le calcule pour couvrir sa fenêtre entière. Il n'y a
//             PLUS de plafond fixe — un plafond tronquait la série par son côté
//             ancien, et les bougies du graphe non couvertes ne portaient alors
//             aucune valeur HTF (donc aucune zone RSIER / TRENDER) en silence.
//
// Le bucket est calculé en arithmétique d'epoch — exactement la même formule que
// bucketOf() dans lib/htf.js — plutôt qu'avec time_bucket, dont l'origine ne
// coïnciderait pas pour W1.

import { query } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { symbolId, sec, off = '0', from, to, limit = '200' } = req.query;

  const id = parseInt(symbolId, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'symbolId invalide' });

  const s = parseInt(sec, 10);
  if (!Number.isFinite(s) || s < 60 || s > 2_592_000)
    return res.status(400).json({ error: 'sec invalide' });

  const o = Number.isFinite(parseInt(off, 10)) ? parseInt(off, 10) : 0;
  const n = Math.max(1, parseInt(limit, 10) || 200);

  const toTs = Number(to);
  const toFilter = Number.isFinite(toTs) ? `AND epoch(ts) < ${toTs}` : '';

  const fromTs = Number(from);
  const fromFilter = Number.isFinite(fromTs) ? `AND epoch(ts) >= ${fromTs}` : '';

  const sql = `
    SELECT * FROM (
      SELECT
        (floor((epoch(ts) - ${o}) / ${s}) * ${s} + ${o})::INTEGER AS time,
        arg_max(close, ts)::DOUBLE                                AS close
      FROM bars_m1
      WHERE symbol_id = ${id} ${fromFilter} ${toFilter}
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT ${n}
    ) ORDER BY time ASC
  `;

  try {
    res.json(await query(sql));
  } catch (err) {
    console.error('[htf]', err);
    res.status(500).json({ error: err.message });
  }
}
