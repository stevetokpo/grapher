// ── Geometry helpers for drawing objects ──────────────────────────────────

// Number of anchor points required to complete each drawing type.
// Infinity = unlimited (polyline/path, completed on double-click).
export function getRequiredPoints(type) {
  if (['hline', 'vline', 'crossline'].includes(type))              return 1;
  if (['channel_parallel', 'channel_raff', 'triangle'].includes(type)) return 3;
  if (['channel_disjoint'].includes(type))                          return 4;
  if (type === 'path')                                              return Infinity;
  return 2;
}

// Signed perpendicular distance of (px,py) from the line through (ax,ay) with direction (dx,dy)
export function perpOffset(px, py, ax, ay, dx, dy) {
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  return ((px - ax) * (-dy) + (py - ay) * dx) / len;
}

// Linear regression of candle closes in [t1,t2]; returns { startPrice, endPrice, stdDev } or null
export function linearRegression(candles, t1, t2) {
  const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
  const sub = candles.filter(c => c.time >= lo && c.time <= hi);
  if (sub.length < 2) return null;
  const n = sub.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const y = sub[i].close;
    sx += i; sy += y; sxx += i * i; sxy += i * y;
  }
  const det = n * sxx - sx * sx;
  if (!det) return null;
  const slope = (n * sxy - sx * sy) / det;
  const intercept = (sy - slope * sx) / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (sub[i].close - (slope * i + intercept)) ** 2;
  return {
    startPrice: intercept,
    endPrice:   slope * (n - 1) + intercept,
    stdDev:     Math.sqrt(sq / n),
  };
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToLine(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs((py - ay) * dx - (px - ax) * dy) / len;
}

// Extend from (ax,ay) through (bx,by) to canvas edge
export function rayEndPoint(ax, ay, bx, by, W, H) {
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return { x: bx, y: by };
  let t = Infinity;
  if (dy < 0) t = Math.min(t, (0     - ay) / dy);
  if (dy > 0) t = Math.min(t, (H     - ay) / dy);
  if (dx < 0) t = Math.min(t, (0     - ax) / dx);
  if (dx > 0) t = Math.min(t, (W     - ax) / dx);
  return { x: ax + t * dx, y: ay + t * dy };
}

// Extend in both directions (infinite line)
export function lineEndPoints(ax, ay, bx, by, W, H) {
  return {
    start: rayEndPoint(bx, by, ax, ay, W, H),
    end:   rayEndPoint(ax, ay, bx, by, W, H),
  };
}

export function applyLineStyle(ctx, lineStyle) {
  switch (lineStyle) {
    case 'dashed': ctx.setLineDash([8, 4]); break;
    case 'dotted': ctx.setLineDash([2, 4]); break;
    default:       ctx.setLineDash([]);
  }
}

// Arrowhead at (ex,ey) pointing from (sx,sy)
export function drawArrowHead(ctx, sx, sy, ex, ey, size = 10) {
  const angle = Math.atan2(ey - sy, ex - sx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + size * Math.cos(angle + Math.PI * 0.8), ey + size * Math.sin(angle + Math.PI * 0.8));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex + size * Math.cos(angle - Math.PI * 0.8), ey + size * Math.sin(angle - Math.PI * 0.8));
  ctx.stroke();
}

// Format price difference for ruler label
export function fmtPriceDiff(p1, p2) {
  const diff = p2 - p1;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(5)}`;
}

// Format bar count for ruler label
export function fmtTimeDiff(t1, t2) {
  const secs = Math.abs(t2 - t1);
  if (secs < 60)      return `${secs}s`;
  if (secs < 3600)    return `${Math.round(secs / 60)}m`;
  if (secs < 86400)   return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}j`;
}

// Lighten a hex color for hover effect
export function lightenColor(hex, amount = 40) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, ((n >> 16) & 255) + amount);
  const g = Math.min(255, ((n >> 8)  & 255) + amount);
  const b = Math.min(255, ((n)       & 255) + amount);
  return `rgb(${r},${g},${b})`;
}
