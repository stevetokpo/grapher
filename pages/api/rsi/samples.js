// /api/rsi/samples — le cahier d'échantillons de la corne.
//
//   GET    ?symbolId=&tf=&period=&label=   liste (filtres optionnels)
//   POST   { symbolId, tf, period, minAmp, time, label, note }
//          marque la pointe la plus proche de `time` et l'écrit sur le disque
//   DELETE ?id=…                            retire un échantillon
//
// Le POST ne fait pas confiance au navigateur pour les mesures : il recharge
// l'historique complet, recalcule le RSI et le zigzag, aimante le clic sur la
// pointe la plus proche, et c'est CETTE mesure-là qui est enregistrée.

import { loadTF, TF_SECONDS } from '../../../lib/signals/data';
import { query } from '../../../lib/db';
import { readSamples, buildSample, upsertSample, removeSample } from '../../../lib/rsi/samples';
import { PIVOT_DEFAULTS } from '../../../lib/rsi/features';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET')    return await list(req, res);
    if (req.method === 'POST')   return await create(req, res);
    if (req.method === 'DELETE') return remove(req, res);
    return res.status(405).end();
  } catch (err) {
    console.error('[rsi/samples]', err);
    res.status(500).json({ error: err.message });
  }
}

function list(req, res) {
  const { symbolId, tf, period, label } = req.query;
  let out = readSamples();
  if (symbolId) out = out.filter(s => String(s.symbolId) === String(symbolId));
  if (tf)       out = out.filter(s => s.tf === tf);
  if (period)   out = out.filter(s => String(s.period) === String(period));
  if (label)    out = out.filter(s => s.label === label);
  res.json({
    count: out.length,
    oui:   out.filter(s => s.label === 'oui').length,
    non:   out.filter(s => s.label === 'non').length,
    samples: out,
  });
}

async function create(req, res) {
  const b = req.body ?? {};
  const symbolId = Number(b.symbolId);
  const time     = Number(b.time);
  if (!Number.isFinite(symbolId)) return res.status(400).json({ error: 'symbolId requis' });
  if (!Number.isFinite(time))     return res.status(400).json({ error: 'time requis' });

  const tf = b.tf ?? '1m';
  if (!TF_SECONDS[tf]) return res.status(400).json({ error: `timeframe inconnu : ${tf}` });

  const period = Math.max(2, Number(b.period) || PIVOT_DEFAULTS.period);
  const minAmp = Math.max(0.5, Number(b.minAmp) || PIVOT_DEFAULTS.minAmp);

  const { candles } = await loadTF(symbolId, tf);
  const symbol = b.symbol ?? await symbolName(symbolId);

  const sample = buildSample(candles, {
    symbolId, symbol, tf, period, minAmp,
    time,
    label: b.label,
    note:  b.note,
    snapBars: Math.max(1, Number(b.snapBars) || 6),
  });

  if (!sample) {
    return res.status(404).json({
      error: 'aucune pointe assez proche du clic — vise le sommet, ou baisse l’amplitude du zigzag',
    });
  }

  upsertSample(sample);
  res.json({ sample });
}

function remove(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'id requis' });
  const n = removeSample(id);
  res.json({ removed: n });
}

async function symbolName(symbolId) {
  try {
    const rows = await query(`SELECT name FROM symbols WHERE id = ${Number(symbolId)}`);
    return rows?.[0]?.name ?? null;
  } catch { return null; }
}
