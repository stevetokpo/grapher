// POST /api/rfvg/probe — l'échelle de l'instrument, avant toute optimisation.
//
// Le calcul lui-même est commun à tous les motifs et vit dans
// lib/signals/probe.js — risque structurel réel, amplitude par bougie, spread
// écrit par le broker, dérive buy & hold, nombre de signaux. Ici on ne fait que
// le brancher sur la détection rFVG, en gardant la réponse d'origine.

import { loadZones, toEpoch } from '../../../lib/rfvg/data';
import { probeInstrument } from '../../../lib/signals/probe';
import { DETECT_SCHEMA, EXIT_SCHEMA, sanitize } from '../../../lib/rfvg/params';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const b = req.body ?? {};
    const symbolId = Number(b.symbolId);
    if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });
    const tf = b.tf ?? '15m';

    const det = sanitize(DETECT_SCHEMA, b.detect ?? {});
    const from = toEpoch(b.from);
    const to   = toEpoch(b.to);

    const { candles, ranges, m1, zones } = await loadZones(symbolId, tf, det.params);
    const { params: ex } = sanitize(EXIT_SCHEMA, { slMarginPts: b.slMarginPts });

    const out = await probeInstrument({
      symbolId, candles, m1, ranges, signals: zones, from, to, slMarginPts: ex.slMarginPts,
    });

    res.json({ symbolId, tf, ...out, detect: det.params });
  } catch (err) {
    console.error('[rfvg/probe]', err);
    res.status(err.message?.startsWith('aucune bougie') ? 400 : 500).json({ error: err.message });
  }
}
