// GET|POST /api/rsi/corne — le motif CORNE tel que le GRAPHE le marque, joué sur
// tout l'historique d'un symbole.
//
// Différence avec /api/rsi/scan, et elle est essentielle : `scan` mesure les
// pointes APRÈS COUP, en s'appuyant sur le pivot suivant du zigzag — c'est la
// vue du laboratoire, celle qui sert à régler des seuils sur des exemples.
// Ici, c'est la détection EN DIRECT : à chaque bougie, avec ce qu'on savait à
// cette bougie-là. Les deux ne rendent pas le même compte, et c'est normal ; la
// seule qui ait le droit d'être tradée est celle-ci.
//
//   GET /api/rsi/corne?symbolId=1&tf=1m&rsiPeriod=7&minAmp=8&maxDropBars=2
//   POST { symbolId, tf, ...réglages de lib/corne/params.js, limit }

import { loadTF, toEpoch, TF_SECONDS } from '../../../lib/signals/data';
import { calcCorne } from '../../../lib/corne/detect';
import { DETECT_DEFAULTS } from '../../../lib/corne/params';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const src = req.method === 'POST' ? { ...req.query, ...(req.body ?? {}) } : req.query;

  const symbolId = Number(src.symbolId);
  if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });

  const tf = src.tf ?? '1m';
  if (!TF_SECONDS[tf]) return res.status(400).json({ error: `timeframe inconnu : ${tf}` });

  // Les réglages sont ceux du motif, un par un — tout champ absent garde sa
  // valeur par défaut de lib/corne/params.js.
  const opts = {};
  for (const key of Object.keys(DETECT_DEFAULTS)) {
    if (src[key] == null || src[key] === '') continue;
    opts[key] = key === 'direction' ? String(src[key]) : Number(src[key]);
  }

  const limit = Math.max(0, Number(src.limit) || 0);
  const from  = toEpoch(src.from);
  const to    = toEpoch(src.to);

  try {
    const { candles } = await loadTF(symbolId, tf);
    const all = calcCorne(candles, opts);

    const win = all.filter(c =>
      (!from || c.time >= from) && (!to || c.time <= to));
    const marks = limit && win.length > limit ? win.slice(-limit) : win;

    const bulls = win.filter(c => c.side === 'bull').length;

    res.json({
      symbolId, tf,
      params: { ...DETECT_DEFAULTS, ...opts },
      bars:   candles.length,
      count:  win.length,
      bull:   bulls,
      bear:   win.length - bulls,
      // Une corne toutes les N bougies : le seul chiffre qui dise tout de suite
      // si les seuils décrivent une figure rare ou une banalité.
      every:  win.length ? Math.round(candles.length / win.length) : null,
      marks,
    });
  } catch (err) {
    console.error('[rsi/corne]', err);
    res.status(500).json({ error: err.message });
  }
}
