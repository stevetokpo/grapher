// ─────────────────────────────────────────────────────────────────────────────
// EQ — Equilibrium Point
//
// Where is the market in balance, and is it in balance *right now*?
//
// Auction theory says price advertises opportunity and volume measures
// acceptance: the market rotates around a price both sides agree on (the fair
// price / point of control) until one side rejects it and the auction moves on.
// This module turns that into numbers.
//
// For every bar we rebuild the auction of the last `lookback` bars:
//
//   1. PROFILE   — each bar spreads its volume uniformly over its own range;
//                  summed across the window this gives a volume-by-price
//                  histogram. It is then smoothed with a Gaussian-like kernel
//                  so the mode does not jump between adjacent bins.
//   2. POINT     — the mode of that density, refined to sub-bin precision by
//                  parabolic interpolation: the equilibrium point (POC).
//   3. VALUE     — the value area holding `valueArea`% of the volume, grown
//                  from the point two bins at a time (Steidlmayer's rule).
//   4. SCORE     — six measures of "is this really an equilibrium", combined as
//                  a weighted geometric mean, so failing any one of them
//                  collapses the score: they are conjunctive, not additive.
//                    pull  the point attracts price back to it  ← the core test
//                    uni   one value, not two competing ones
//                    conc  value is concentrated, not smeared along a trend
//                    flat  the window has no net drift
//                    sym   acceptance is symmetric around the point
//                    prox  price is trading at the point right now
//   5. STATE     — crossing `threshold` opens a balance zone, frozen at that
//                  instant. It dies only when price is *accepted* beyond value
//                  and the market stops scoring as an equilibrium; the point it
//                  abandons lives on as a naked POC until price returns to it.
//
// Two things make this different from a volume-profile indicator that merely
// draws a POC:
//
//   · The pull test is out-of-sample. Price mechanically returns to the mode of
//     its own distribution, so measuring attraction toward a point fitted on the
//     same bars is a tautology that scores a random walk as balanced. The
//     reference point is therefore taken from the first half of the window and
//     tested on the second: the past proposes the point, the present judges it.
//   · Balance is not declared by shape alone. A trend, a random walk and a
//     double distribution all produce a POC; only an equilibrium produces one
//     that price keeps coming back to.
//
// Everything reads bars <= i only — no lookahead, no repaint. Same functions can
// drive a backtest as well as the chart.
// ─────────────────────────────────────────────────────────────────────────────

const EPS = 1e-12;

export const EQ_DEFAULTS = {
  lookback:    60,   // bars in the auction window
  levels:      160,  // price rows in the profile
  bandwidth:   0.02, // smoothing kernel sigma, as a fraction of the window range
  valueArea:   70,   // % of volume inside the value area
  threshold:   70,   // score at which balance is declared
  exitScore:   0,    // score below which balance can be broken (0 = threshold − 25)
  confirmBars: 2,    // closes accepted beyond value that break the balance
  breakBuffer: 0.25, // how far past the value-area edge counts as "beyond", in VA widths
  cooldown:    0,    // bars to wait after a break before a new zone may open (0 = W/4)
  maxLen:      0,    // hard cap on zone length in bars (0 = no cap)
  useVolume:   true, // weight bars by volume (off = every bar counts the same)
};

// Conjunctive weights — they sum to 1 and multiply, so a single dead component
// drags the whole score down. Ordered by how much each one *defines* balance.
// `pull` carries the most weight on purpose. The other five describe the shape
// of the auction — and a trend, a random walk and a double distribution all
// produce a shapely profile with a POC. Only pull tests whether the point is an
// equilibrium rather than a picture of one, so it is the component that must be
// hardest to fake.
export const EQ_WEIGHTS = {
  pull: 0.34, // the point attracts price back to it — significantly, and materially
  uni:  0.16, // one value, not two
  conc: 0.16, // value is concentrated, not smeared along a trend
  flat: 0.12, // the window has no net drift
  sym:  0.10, // acceptance is symmetric around the point
  prox: 0.12, // price is at the point *now*
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ── Smoothing ────────────────────────────────────────────────────────────────
// Three box blurs approximate a Gaussian (central limit theorem) at O(n) per
// pass instead of O(n·sigma) for a direct convolution — the profile is rebuilt
// on every bar, so the constant factor matters.

function boxBlur(src, dst, n, radius) {
  const win = 2 * radius + 1;
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += src[Math.min(n - 1, Math.max(0, k))];
  for (let i = 0; i < n; i++) {
    dst[i] = sum / win;
    const out = src[Math.min(n - 1, Math.max(0, i - radius))];
    const inc = src[Math.min(n - 1, Math.max(0, i + radius + 1))];
    sum += inc - out;
  }
}

function smooth(src, dst, tmp, n, sigma) {
  // Box width that makes three passes match the target sigma.
  let w = Math.floor(Math.sqrt((12 * sigma * sigma) / 3 + 1));
  if (w % 2 === 0) w -= 1;
  const radius = Math.max(1, (w - 1) / 2);
  boxBlur(src, dst, n, radius);
  boxBlur(dst, tmp, n, radius);
  boxBlur(tmp, dst, n, radius);
}

// ── Value area ───────────────────────────────────────────────────────────────
// Grow from the POC, each step taking the richer of the two bins above or the
// two bins below, until the target share of volume is enclosed.

function valueArea(prof, n, pocIdx, total, sharePct) {
  const target = total * (sharePct / 100);
  let lo = pocIdx, hi = pocIdx;
  let acc = prof[pocIdx];

  while (acc < target && (lo > 0 || hi < n - 1)) {
    const up = (hi + 1 < n ? prof[hi + 1] : 0) + (hi + 2 < n ? prof[hi + 2] : 0);
    const dn = (lo - 1 >= 0 ? prof[lo - 1] : 0) + (lo - 2 >= 0 ? prof[lo - 2] : 0);
    if (up <= 0 && dn <= 0) break;
    if (up >= dn) { acc += up; hi = Math.min(n - 1, hi + 2); }
    else          { acc += dn; lo = Math.max(0, lo - 2); }
  }
  return { lo, hi };
}

// ── Unimodality ──────────────────────────────────────────────────────────────
// A second distribution means the market is arguing between two values — the
// textbook signature of a market *leaving* balance, not sitting in it.
// Measured as the topographic prominence of the strongest rival peak, relative
// to the main peak: prominence = (its height − the deepest valley separating it
// from the POC) / POC height. A shoulder scores ~0, a true twin peak ~1.

function bimodality(prof, n, pocIdx) {
  const h1 = prof[pocIdx];
  if (h1 <= EPS) return 0;

  let worst = 0;

  // Walk outward from the POC on each side, tracking the running valley depth.
  for (const dir of [-1, 1]) {
    let valley = h1;
    for (let k = pocIdx + dir; k >= 0 && k < n; k += dir) {
      const v = prof[k];
      if (v < valley) valley = v;

      const prev = prof[k - dir];
      const next = k + dir >= 0 && k + dir < n ? prof[k + dir] : -1;
      const isPeak = v > prev && v >= next;
      if (isPeak) {
        const prom = (v - valley) / h1;
        if (prom > worst) worst = prom;
      }
    }
  }
  return clamp01(worst);
}

// ── The auction profile of one window ────────────────────────────────────────

function buildProfile(candles, from, to, p, buf) {
  const L = p.levels;

  let lo = Infinity, hi = -Infinity;
  for (let j = from; j <= to; j++) {
    if (candles[j].low  < lo) lo = candles[j].low;
    if (candles[j].high > hi) hi = candles[j].high;
  }
  if (!(hi > lo)) return null;

  const step = (hi - lo) / (L - 1);
  const { diff, hist, prof, tmp } = buf;

  // Spread every bar's volume across the rows it traded through. Written as a
  // difference array so each bar costs O(1) instead of O(rows it spans).
  diff.fill(0);
  for (let j = from; j <= to; j++) {
    const c = candles[j];
    const v = p.useVolume ? (c.volume > 0 ? c.volume : 1) : 1;
    let a = Math.round((c.low  - lo) / step);
    let b = Math.round((c.high - lo) / step);
    if (a < 0) a = 0;
    if (b > L - 1) b = L - 1;
    if (b < a) b = a;
    const d = v / (b - a + 1);
    diff[a]     += d;
    diff[b + 1] -= d;
  }
  let run = 0;
  for (let k = 0; k < L; k++) { run += diff[k]; hist[k] = run; }

  smooth(hist, prof, tmp, L, Math.max(0.8, p.bandwidth * (L - 1)));

  let total = 0, pocIdx = 0, peak = -1;
  for (let k = 0; k < L; k++) {
    total += prof[k];
    if (prof[k] > peak) { peak = prof[k]; pocIdx = k; }
  }
  if (total <= EPS) return null;

  // Sub-bin mode: fit a parabola through the peak and its two neighbours so the
  // point does not snap to the grid as the window slides.
  let shift = 0;
  if (pocIdx > 0 && pocIdx < L - 1) {
    const a = prof[pocIdx - 1], b = prof[pocIdx], c = prof[pocIdx + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > EPS) shift = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  }

  return { lo, hi, step, total, pocIdx, poc: lo + (pocIdx + shift) * step, prof };
}

// ── Core: profile + metrics for one window ───────────────────────────────────

function analyzeWindow(candles, from, to, p, buf, refBuf) {
  const L = p.levels;

  const P = buildProfile(candles, from, to, p, buf);
  if (!P) return null;
  const { lo, hi, step, total, pocIdx, poc, prof } = P;

  const va  = valueArea(prof, L, pocIdx, total, p.valueArea);
  const val = lo + va.lo * step;
  const vah = lo + va.hi * step;
  const vaW = Math.max(vah - val, step);

  // ── The six measures ───────────────────────────────────────────────────────

  // Unimodal: no rival distribution.
  const uni = 1 - bimodality(prof, L, pocIdx);

  // Concentrated: in a trend the profile flattens out and the value area has to
  // swell to hold its share of volume, approaching the whole range. Normalised
  // by the share itself, so it stays honest if valueArea is not 70%.
  const share = p.valueArea / 100;
  const conc  = clamp01((1 - (vah - val) / (hi - lo) / share) / 0.4);

  // Attracting: an equilibrium is a point the market is *pulled back to*. Fit
  // the reversion rate theta of  dp = theta·(point − p) + noise.  theta > 0, the
  // point attracts; theta ≈ 0, a random walk merely loitering; theta < 0, price
  // is escaping.
  //
  // The point must not be fitted and tested on the same bars: price mechanically
  // returns to the mode of its own distribution, so an in-sample theta is
  // positive even for a random walk — a tautology, not a measurement. So the
  // reference point is the mode of the FIRST half of the window, and the pull is
  // measured over the SECOND half only. The past proposes the point; the present
  // either honours it or does not. Still strictly causal: nothing past bar `to`.
  const mid = from + ((to - from) >> 1);
  const R   = buildProfile(candles, from, mid, p, refBuf);
  const ref = R ? R.poc : poc;

  let sPP = 0, sPD = 0;
  for (let j = mid; j < to; j++) {
    const dev = ref - candles[j].close;
    sPP += dev * dev;
    sPD += dev * (candles[j + 1].close - candles[j].close);
  }
  const m     = to - mid;              // observations in the test segment
  const theta = sPP > EPS ? sPD / sPP : 0;

  // Theta on its own is not evidence. Estimated over a few dozen bars it is a
  // noisy number, and a random walk throws off a positive one often enough to
  // fake balance a fifth of the time. So it has to clear two independent bars:
  //
  //   statistical — t = theta / SE(theta), the regression t-stat. Under the
  //                 random-walk null the point is not an attractor and t is
  //                 standard-normal-ish. Scoring is a gate, not a ramp: nothing
  //                 below t=1 (which noise clears one time in six), full marks
  //                 only past t=2.5 (which noise clears once in 150). A linear
  //                 ramp from zero is what lets a random walk fake balance.
  //   economic    — the pull must also be *material*: a deviation has to halve
  //                 at least twice over the test segment. A tiny theta can be
  //                 highly significant given enough bars, and a point that takes
  //                 300 bars to reclaim price is not an equilibrium anyone can
  //                 trade.
  //
  // Both, or neither. The weaker of the two is the score.
  let sse = 0;
  for (let j = mid; j < to; j++) {
    const dev = ref - candles[j].close;
    const r   = (candles[j + 1].close - candles[j].close) - theta * dev;
    sse += r * r;
  }
  const se = m > 2 && sPP > EPS ? Math.sqrt(sse / (m - 1) / sPP) : Infinity;
  const t  = se > EPS && Number.isFinite(se) ? theta / se : 0;

  const thetaRef = (2 * Math.LN2) / Math.max(2, m);
  const pull = Math.min(
    clamp01((t - 1) / 1.5),          // significance gate: t=1 → 0, t=2.5 → 1
    clamp01(theta / thetaRef),       // materiality
  );

  // Flat: net drift across the window, measured in value-area widths. Balance
  // may be noisy but it has to end up where it started.
  const w = to - from + 1;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let j = from; j <= to; j++) {
    const x = j - from, y = candles[j].close;
    sx += x; sy += y; sxy += x * y; sxx += x * x;
  }
  const varX  = w * sxx - sx * sx;
  const slope = Math.abs(varX) > EPS ? (w * sxy - sx * sy) / varX : 0;
  const drift = Math.abs(slope * (w - 1));
  const flat  = Math.exp(-drift / vaW);

  // Symmetric: acceptance above the point mirrors acceptance below it. Finite
  // samples are never exactly even, so the penalty is Gaussian rather than linear.
  let volUp = 0, volDn = 0;
  for (let k = 0; k < pocIdx; k++) volDn += prof[k];
  for (let k = pocIdx + 1; k < L; k++) volUp += prof[k];
  const imb = Math.abs(volUp - volDn) / (volUp + volDn + EPS);
  const sym = Math.exp(-2 * imb * imb);

  // Present: the market is trading at the point right now, not merely near a
  // point it left behind. Distance in value-area half-widths.
  const d    = (candles[to].close - poc) / (vaW / 2);
  const prox = Math.exp(-0.5 * d * d);

  const mm = { uni, conc, pull, flat, sym, prox };

  // Weighted geometric mean: conjunctive by construction — one dead component
  // cannot be bought back by the other five. The 0.05 floor keeps the log finite
  // and leaves the score a readable range below the threshold; it is loose
  // enough to read ("the shape is there, the proof is not") and still tight
  // enough that a profile with no attractor at all — every other component
  // perfect, pull at zero — tops out at 38. Balance cannot be declared on shape.
  let logSum = 0;
  for (const k in EQ_WEIGHTS) logSum += EQ_WEIGHTS[k] * Math.log(Math.max(mm[k], 0.05));
  const score = 100 * Math.exp(logSum);

  return { poc, val, vah, lo, hi, score, theta, tstat: t, ref, ...mm };
}

// ── Public entry point ───────────────────────────────────────────────────────
//
// Returns:
//   points  Map<time, snapshot>       per-bar analysis (tooltip / strategy use)
//   line    [{ time, value, color }]  the equilibrium point, shaded by score
//   score   [{ time, value }]         the 0-100 balance score
//   zones   [{ ... }]                 balance zones, frozen at detection
//   nakedPOCs [{ ... }]               abandoned points awaiting a retest

export function calcEquilibrium(candles, params = {}) {
  const p = { ...EQ_DEFAULTS, ...params };
  const empty = { points: new Map(), line: [], score: [], zones: [], nakedPOCs: [] };

  const n = candles?.length ?? 0;
  const W = Math.max(10, Math.floor(p.lookback));
  const L = Math.max(40, Math.floor(p.levels));
  if (n < W + 1) return empty;

  p.lookback = W;
  p.levels   = L;

  const mkBuf = () => ({
    diff: new Float64Array(L + 1),
    hist: new Float64Array(L),
    prof: new Float64Array(L),
    tmp:  new Float64Array(L),
  });
  const buf    = mkBuf();  // full window
  const refBuf = mkBuf();  // first half, for the out-of-sample pull test

  const points = new Map();
  const line   = [];
  const score  = [];
  const zones  = [];

  const [cr, cg, cb] = hexRGB(params.color ?? '#A78BFA');

  let zone = null;   // open balance zone
  let out  = 0;      // consecutive closes accepted beyond its value area
  const cool = p.cooldown > 0 ? Math.floor(p.cooldown) : Math.round(W / 4);
  const exit = p.exitScore > 0 ? p.exitScore : Math.max(0, p.threshold - 25);
  let reopenAt = 0;  // earliest bar index at which a new zone may open

  // One pass: analyse the window, emit the series, step the state machine. The
  // profile buffer is still warm when a zone opens, so its shape is captured
  // for free at exactly the bar that justified it.
  for (let i = W - 1; i < n; i++) {
    const s = analyzeWindow(candles, i - W + 1, i, p, buf, refBuf);
    if (!s) continue;

    const c = candles[i];
    const t = c.time;
    points.set(t, s);
    score.push({ time: t, value: s.score });

    // The point fades out when the market is not in balance: it still exists,
    // it just stops meaning anything.
    const a = 0.18 + 0.82 * Math.pow(s.score / 100, 1.6);
    line.push({ time: t, value: s.poc, color: `rgba(${cr},${cg},${cb},${a.toFixed(3)})` });

    if (!zone) {
      // After value is rejected, the market has to actually build something new
      // before we are willing to call it balance again — the window still holds
      // the bars of the auction that just died, and would happily re-detect it.
      if (i >= reopenAt && s.score >= p.threshold) {
        zone = {
          startIdx:   i - W + 1,
          anchorIdx:  i,                     // bar where balance was recognised
          endIdx:     i,
          startTime:  candles[i - W + 1].time,
          anchorTime: t,
          endTime:    t,
          poc: s.poc, val: s.val, vah: s.vah,
          breakUp: s.vah + p.breakBuffer * (s.vah - s.val),
          breakDn: s.val - p.breakBuffer * (s.vah - s.val),
          score: s.score,
          state: 'active',
          breakSide: null,
          // Normalised shape of the auction that produced the point, so the
          // chart can show *why* this is the equilibrium and not just where.
          profile: normalized(buf.prof, L),
          profLo:  s.lo,
          profHi:  s.hi,
        };
        out = 0;
      }
      continue;
    }

    // Zone is open: it lives on the market's willingness to keep trading inside
    // the value it built. Everything below is frozen geometry — only the right
    // edge moves.
    zone.endIdx  = i;
    zone.endTime = c.time;
    if (s.score > zone.score) zone.score = s.score;

    // Value is not rejected the moment price pokes out of it — by construction
    // a third of the auction's volume trades outside the value area, and a
    // balanced market pokes out of its own value all the time. Balance ends on
    // *acceptance*: price closes beyond value (by a margin, repeatedly) AND the
    // market stops scoring as an equilibrium at all. Either alone is noise; a
    // stubborn excursion breaks it regardless, as a backstop.
    const above = c.close > zone.breakUp;
    const below = c.close < zone.breakDn;

    if (above || below) {
      out++;
      const rejected = (out >= p.confirmBars && s.score < exit) || out >= 4 * p.confirmBars;
      if (rejected) {
        zone.state     = 'broken';
        zone.breakSide = above ? 'up' : 'down';
        zone.breakIdx  = i;
        zone.breakTime = c.time;
        zones.push(zone);
        zone     = null;
        out      = 0;
        reopenAt = i + cool;
      }
    } else {
      out = 0;
      if (p.maxLen > 0 && zone.endIdx - zone.anchorIdx + 1 >= p.maxLen) {
        zone.state = 'expired';
        zones.push(zone);
        zone     = null;
        reopenAt = i + cool;
      }
    }
  }
  if (zone) { zone.state = 'live'; zones.push(zone); }

  // ── Naked POCs ─────────────────────────────────────────────────────────────
  // A broken balance leaves unfinished business: the price both sides once
  // agreed on, now abandoned. It stays on the chart until the market comes back
  // and trades it again.
  const nakedPOCs = [];
  for (const z of zones) {
    if (z.state !== 'broken') continue;
    let testIdx = -1;
    for (let i = z.breakIdx + 1; i < n; i++) {
      if (candles[i].low <= z.poc && candles[i].high >= z.poc) { testIdx = i; break; }
    }
    nakedPOCs.push({
      price:     z.poc,
      startTime: z.breakTime,
      endTime:   testIdx >= 0 ? candles[testIdx].time : null, // null = still naked
      side:      z.breakSide,
      tested:    testIdx >= 0,
    });
  }

  return { points, line, score, zones, nakedPOCs };
}

// ── Per-bar causal view, for strategies and backtests ────────────────────────
//
// calcEquilibrium returns zones as objects whose `endIdx`, `breakIdx` and
// running `score` are only known once the zone is over — reading those from a
// strategy would be lookahead. This flattens the state machine into arrays that
// hold, at index i, exactly what was knowable at the close of bar i:
//
//   score/poc/val/vah[i]  the analysis of the window ending at bar i
//   zone[i]               the balance zone alive at bar i, frozen at its anchor
//                         (membership is decided by bars <= i: the zone opened
//                          before i and had not been rejected by i)
//   brk[i]                'up' | 'down' when a zone is rejected at this close
//
// Never read zone.score or zone.endIdx from a strategy — use score[i].

export function eqPerBar(candles, params = {}) {
  const eq = calcEquilibrium(candles, params);
  const n  = candles?.length ?? 0;

  const score = new Array(n).fill(null);
  const poc   = new Array(n).fill(null);
  const val   = new Array(n).fill(null);
  const vah   = new Array(n).fill(null);
  const zone  = new Array(n).fill(null);
  const brk   = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const s = eq.points.get(candles[i].time);
    if (!s) continue;
    score[i] = s.score;
    poc[i]   = s.poc;
    val[i]   = s.val;
    vah[i]   = s.vah;
  }

  for (const z of eq.zones) {
    for (let i = z.anchorIdx; i <= z.endIdx; i++) zone[i] = z;
    if (z.state === 'broken') brk[z.breakIdx] = z.breakSide;
  }

  return { score, poc, val, vah, zone, brk, zones: eq.zones };
}

// Profile scaled to 0..1 by its peak — the renderer only cares about shape.
function normalized(src, n) {
  let peak = 0;
  for (let k = 0; k < n; k++) if (src[k] > peak) peak = src[k];
  const out = new Array(n);
  if (peak <= EPS) return out.fill(0);
  for (let k = 0; k < n; k++) out[k] = src[k] / peak;
  return out;
}

function hexRGB(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}
