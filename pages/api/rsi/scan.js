// GET|POST /api/rsi/scan — toutes les pointes du RSI d'un symbole, mesurées.
//
// Le balayage tourne sur l'historique COMPLET du symbole, puis fenêtre les
// résultats. Il rend les pointes RETENUES par les seuils comme les REFUSÉES,
// avec pour chacune la liste des critères qui ont sauté : c'est ce qui permet de
// voir si un seuil coupe au bon endroit, au lieu de contempler une liste vide.
//
//   GET  /api/rsi/scan?symbolId=1&tf=1m&period=7&minRiseBars=8&maxDropBars=2
//   POST /api/rsi/scan   { symbolId, tf, period, rules: {...}, only, limit }
//
//   only  'matches' (défaut) | 'all'    limit  0 = tout

import { loadTF, toEpoch, TF_SECONDS } from '../../../lib/signals/data';
import { scanHorns, describe, HORN_RULES } from '../../../lib/rsi/features';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const src = req.method === 'POST' ? { ...req.query, ...(req.body ?? {}) } : req.query;

  const symbolId = Number(src.symbolId);
  if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });

  const tf = src.tf ?? '1m';
  if (!TF_SECONDS[tf]) return res.status(400).json({ error: `timeframe inconnu : ${tf}` });

  const period = Math.max(2, Number(src.period) || 7);
  const rules  = readRules(src);
  const only   = src.only === 'all' ? 'all' : 'matches';
  const limit  = Math.max(0, Number(src.limit) || 0);
  const from   = toEpoch(src.from);
  const to     = toEpoch(src.to);

  try {
    const { candles } = await loadTF(symbolId, tf);
    const { horns, pivots } = scanHorns(candles, { period, rules });

    const inWindow = horns.filter(h =>
      (!from || h.timePeak >= from) && (!to || h.timePeak <= to));
    const matched = inWindow.filter(h => h.ok);

    let out = only === 'all' ? inWindow : matched;
    if (limit && out.length > limit) out = out.slice(-limit);

    // Pourquoi les refusées le sont : le compte des critères bloquants dit
    // lequel des seuils fait tout le travail — et lequel ne sert à rien.
    const fails = {};
    for (const h of inWindow) for (const f of h.fails) fails[f] = (fails[f] ?? 0) + 1;

    res.json({
      symbolId, tf, period, rules,
      bars:      candles.length,
      pivots:    pivots.length,
      candidates: inWindow.length,
      matched:   matched.length,
      hitRate:   inWindow.length ? Math.round(1000 * matched.length / inWindow.length) / 10 : 0,
      fails,
      stats: { all: describe(inWindow), matched: describe(matched) },
      horns: out,
    });
  } catch (err) {
    console.error('[rsi/scan]', err);
    res.status(500).json({ error: err.message });
  }
}

// Les seuils arrivent soit à plat en query (?minRiseBars=8), soit dans `rules`.
function readRules(src) {
  const rules = { ...HORN_RULES, ...(src.rules ?? {}) };
  for (const key of Object.keys(HORN_RULES)) {
    if (key === 'side') continue;
    if (src[key] != null && src[key] !== '') {
      const v = Number(src[key]);
      if (Number.isFinite(v)) rules[key] = v;
    }
  }
  if (src.side === 'bear' || src.side === 'bull' || src.side === 'both') rules.side = src.side;
  return rules;
}
