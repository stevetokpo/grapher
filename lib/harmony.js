// TRENDER — Harmonie Multi-HTF
// Portage de pines/trender.pine (« Harmonie Multi-HTF — MIN »).
//
// Sur chacune des 3 unités de temps supérieures, une Bollinger(bbLen, bbMult)
// sur les closes HTF donne un biais : 1 (close > base + dev), −1 (< base − dev),
// 0 (neutre). L'HARMONIE STRICTE est atteinte quand TOUS les HTF actifs sont
// alignés dans le même sens — et une zone court tant qu'elle le reste.
//
// Non-repaint, comme le Pine (lookahead_on + [1]) : chaque bougie du graphe lit
// la tendance de la dernière bougie HTF CLÔTURÉE. Ce qui est affiché sur une
// bougie ne changera plus jamais.
//
// Deux informations sont figées à la bougie de DÉTECTION et valent pour toute
// la zone :
//   · le ou les HTF CONFIRMATEURS — ceux dont la tendance a basculé sur cette
//     bougie précise. Les autres étaient déjà alignés : c'est le confirmateur
//     qui complète l'harmonie, donc lui qui la déclenche.
//   · le niveau « ≈ SL » — la base des Bollinger du timeframe courant, gelée à
//     cet instant et tracée à l'horizontale sur toute la zone.

import { HTF_SECONDS, HTF_OFFSET, htfTrendPerBar, htfBarsFromCandles, htfLabel } from './htf';

export { HTF_SECONDS, htfLabel };

export const HARMONY_DEFAULTS = {
  useHtf1: true, htf1: 'H1',
  useHtf2: true, htf2: 'H4',
  useHtf3: true, htf3: 'H16',
  bbLen: 50, bbMult: 0.369,
  confFlt: 'toutes',      // 'toutes' | 'HTF 1' | 'HTF 2' | 'HTF 3'
  bbCurLen: 50, bbCurMult: 0.369,
};

// Base des Bollinger du timeframe courant (SMA des closes) — sert au niveau ≈ SL.
function smaClose(candles, period) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// Les HTF actifs d'un indicateur TRENDER.
export function activeHtfKeys(ind) {
  return [
    ind.useHtf1 !== false && (ind.htf1 ?? HARMONY_DEFAULTS.htf1),
    ind.useHtf2 !== false && (ind.htf2 ?? HARMONY_DEFAULTS.htf2),
    ind.useHtf3 !== false && (ind.htf3 ?? HARMONY_DEFAULTS.htf3),
  ].filter(k => k && HTF_SECONDS[k]);
}

// Ce qu'il faut demander à /api/htf pour couvrir un graphe : assez de bougies HTF
// pour enjamber la fenêtre affichée, PLUS les bbLen+1 que la Bollinger consomme
// avant de produire sa première valeur.
//
// La borne `to` est le début du bucket courant : on ne sert que des bougies HTF
// CLÔTURÉES. Deux bénéfices — la tendance ne lit de toute façon que des bougies
// closes, et la requête ne change qu'au passage d'un bucket au lieu de changer à
// chaque bougie (essentiel en replay, où le curseur avance sans arrêt).
export function htfRequests(indicators, candles) {
  const n = candles?.length ?? 0;
  if (!n) return [];

  const first = candles[0].time;
  const last  = candles[n - 1].time;
  const byKey = new Map();

  for (const ind of indicators) {
    if (ind.type !== 'TRENDER') continue;
    const bbLen = Math.max(1, Math.floor(ind.bbLen ?? HARMONY_DEFAULTS.bbLen));

    for (const key of activeHtfKeys(ind)) {
      const sec  = HTF_SECONDS[key];
      const off  = HTF_OFFSET[key] ?? 0;
      const span = Math.ceil((last - first) / sec) + 2;
      const need = Math.min(5000, span + bbLen + 2);
      const to   = Math.floor((last - off) / sec) * sec + off;

      const prev = byKey.get(key);
      if (!prev || need > prev.limit) byKey.set(key, { key, sec, off, to, limit: need });
    }
  }
  return [...byKey.values()];
}

// Renvoie les zones d'harmonie. Chaque zone est un intervalle maximal de bougies
// où tous les HTF actifs pointent dans le même sens.
//
//   htfSeries  { H1: [{time, close}], … } servi par /api/htf. Optionnel : sans
//              lui la série HTF est reconstruite depuis `candles`, ce qui la
//              limite à ce que le graphe a chargé (le backtest fonctionne ainsi,
//              avec sa propre marge de warm-up).
//
//   zones:  [{ side, startIdx, endIdx, startTime, endTime, confirm[], slLevel, visible }]
//   warmup: { ok, htf, have, need } — l'HTF le plus court en historique
export function calcHarmony(candles, params = {}, htfSeries = null) {
  const p = { ...HARMONY_DEFAULTS, ...params };
  const n = candles?.length ?? 0;
  if (!n) return { zones: [], warmup: { ok: true } };

  const bbLen  = Math.max(1, Math.floor(p.bbLen));
  const bbMult = p.bbMult;

  const used = [
    p.useHtf1 ? p.htf1 : null,
    p.useHtf2 ? p.htf2 : null,
    p.useHtf3 ? p.htf3 : null,
  ];
  // Série servie par l'API si elle est là ; sinon reconstruite depuis le graphe.
  const seriesOf = key => (htfSeries?.[key]?.length ? htfSeries[key] : null);

  const trends = used.map(key =>
    key && HTF_SECONDS[key]
      ? htfTrendPerBar(candles, HTF_SECONDS[key], HTF_OFFSET[key] ?? 0, bbLen, bbMult, seriesOf(key))
      : null,
  );
  const active = trends.filter(Boolean).length;
  if (active === 0) return { zones: [], warmup: { ok: true } };

  // La Bollinger consomme bbLen bougies HTF, et le non-repaint une de plus (on
  // lit la dernière HTF *clôturée*). Si l'HTF le plus court n'en a pas assez, sa
  // tendance reste à 0 et l'harmonie STRICTE devient impossible : aucune zone ne
  // peut exister. Ça n'arrive plus que si la base elle-même manque d'historique.
  const need = bbLen + 1;
  let warmup = { ok: true };
  for (const key of used) {
    if (!key) continue;
    const have = (seriesOf(key) ?? htfBarsFromCandles(candles, HTF_SECONDS[key], HTF_OFFSET[key] ?? 0)).length;
    if (have < need && (warmup.ok || have < warmup.have)) {
      warmup = { ok: false, htf: key, have, need };
    }
  }

  const basis = smaClose(candles, Math.max(1, Math.floor(p.bbCurLen)));
  const fltIdx = p.confFlt === 'HTF 1' ? 0 : p.confFlt === 'HTF 2' ? 1 : p.confFlt === 'HTF 3' ? 2 : -1;

  const zones = [];
  let open = null;          // zone en cours
  let prevBull = false, prevBear = false;

  for (let i = 0; i < n; i++) {
    let score = 0;
    for (const t of trends) if (t) score += t[i];

    const bull = score === active;
    const bear = score === -active;
    const startBull = bull && !prevBull;
    const startBear = bear && !prevBear;

    // Une zone se termine dès que l'harmonie se rompt — ou bascule d'un coup
    // dans l'autre sens, sans bougie neutre entre les deux.
    if (open && !(open.side === 'bull' ? bull : bear)) {
      open.endIdx  = i - 1;
      open.endTime = candles[i - 1].time;
      zones.push(open);
      open = null;
    }

    if (startBull || startBear) {
      // Confirmateurs : les HTF qui ont basculé SUR cette bougie.
      const confirm = [];
      for (let k = 0; k < 3; k++) {
        const t = trends[k];
        if (t && i > 0 && t[i] !== t[i - 1]) confirm.push(htfLabel(used[k]));
      }
      // Le filtre est évalué à la détection puis figé pour toute la zone.
      const visible = fltIdx < 0
        ? true
        : Boolean(trends[fltIdx]) && i > 0 && trends[fltIdx][i] !== trends[fltIdx][i - 1];

      open = {
        side:      startBull ? 'bull' : 'bear',
        startIdx:  i,
        startTime: candles[i].time,
        endIdx:    i,
        endTime:   candles[i].time,
        confirm,
        slLevel:   basis[i],   // base BB du TF courant, gelée ici
        visible,
      };
    }

    prevBull = bull;
    prevBear = bear;
  }

  // Zone encore ouverte sur la dernière bougie
  if (open) {
    open.endIdx  = n - 1;
    open.endTime = candles[n - 1].time;
    zones.push(open);
  }

  return { zones: zones.filter(z => z.visible), warmup };
}
