import { useRef, useEffect, useCallback } from 'react';
import {
  distToSegment,
  rayEndPoint, lineEndPoints,
  applyLineStyle, drawArrowHead,
  fmtPriceDiff, fmtTimeDiff,
  lightenColor,
  getRequiredPoints,
  perpOffset,
  linearRegression,
} from '../../lib/drawingUtils';

// Position tools are drag-based: pointerdown = entry, pointerup = TP (SL is mirrored)
const DRAG_TOOLS = new Set(['position_long', 'position_short']);

const HIT    = 7;
const HANDLE = 5;

// ── Helpers ───────────────────────────────────────────────────────────────

function channelOffset(pts, W, H) {
  if (pts.length < 3) return null;
  const [p1, p2, p3] = pts;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  const off = perpOffset(p3.x, p3.y, p1.x, p1.y, dx, dy);
  return { dx, dy, len, off, nx: off * (-dy) / len, ny: off * dx / len };
}

function drawChannelFill(ctx, s1, e1, s2, e2, color) {
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y);
  ctx.lineTo(e2.x, e2.y); ctx.lineTo(s2.x, s2.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Render one completed drawing ──────────────────────────────────────────
function renderDrawing(ctx, d, W, H, toPixel, selected, hovered) {
  const pts = d.points.map(p => toPixel(p.time, p.price)).filter(Boolean);
  if (!pts.length) return;

  const color  = d.style?.color     ?? '#2196F3';
  const lw     = d.style?.lineWidth ?? 1;
  const ls     = d.style?.lineStyle ?? 'solid';
  const stroke = hovered ? lightenColor(color) : color;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth   = selected ? lw + 0.5 : lw;
  ctx.lineCap     = 'round';
  applyLineStyle(ctx, ls);

  const a = pts[0], b = pts[1] ?? pts[0];

  switch (d.type) {
    // ── Phase 1 — Lignes ────────────────────────────────────────────────
    case 'segment':
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      break;
    case 'ray': {
      const end = rayEndPoint(a.x, a.y, b.x, b.y, W, H);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      break;
    }
    case 'trendline': {
      const { start, end } = lineEndPoints(a.x, a.y, b.x, b.y, W, H);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      break;
    }
    case 'hline':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = stroke;
      ctx.textAlign = 'right';
      ctx.fillText(d.points[0].price.toFixed(5), W - 6, a.y - 4);
      break;
    case 'vline':
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H); ctx.stroke();
      break;
    case 'crossline':
      ctx.beginPath();
      ctx.moveTo(0, a.y); ctx.lineTo(W, a.y);
      ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H);
      ctx.stroke();
      break;
    case 'arrow':
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      drawArrowHead(ctx, a.x, a.y, b.x, b.y, 8 + lw * 2);
      break;
    case 'ruler': {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const tick  = 7;
      for (const pt of [a, b]) {
        ctx.beginPath();
        ctx.moveTo(pt.x + tick * Math.cos(angle), pt.y + tick * Math.sin(angle));
        ctx.lineTo(pt.x - tick * Math.cos(angle), pt.y - tick * Math.sin(angle));
        ctx.stroke();
      }
      if (d.points.length >= 2) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const text = `${fmtPriceDiff(d.points[0].price, d.points[1].price)}  ${fmtTimeDiff(d.points[0].time, d.points[1].time)}`;
        ctx.font = 'bold 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(11,14,23,0.85)';
        ctx.fillRect(mx - tw / 2 - 4, my - 16, tw + 8, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, mx, my - 4);
      }
      break;
    }

    // ── Phase 2 — Canaux ────────────────────────────────────────────────
    case 'channel_parallel': {
      const ch = channelOffset(pts, W, H);
      if (!ch) { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); break; }
      const { nx, ny } = ch;
      const { start: s1, end: e1 } = lineEndPoints(a.x,      a.y,      b.x,      b.y,      W, H);
      const { start: s2, end: e2 } = lineEndPoints(a.x + nx, a.y + ny, b.x + nx, b.y + ny, W, H);
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s2.x, s2.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
      drawChannelFill(ctx, s1, e1, s2, e2, color);
      break;
    }
    case 'channel_raff': {
      const ch = channelOffset(pts, W, H);
      if (!ch) { ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); break; }
      const { nx, ny } = ch;
      // Midline
      const { start: sm, end: em } = lineEndPoints(a.x,      a.y,      b.x,      b.y,      W, H);
      // Upper / lower bands (symmetric)
      const { start: su, end: eu } = lineEndPoints(a.x + nx, a.y + ny, b.x + nx, b.y + ny, W, H);
      const { start: sl, end: el } = lineEndPoints(a.x - nx, a.y - ny, b.x - nx, b.y - ny, W, H);
      ctx.beginPath(); ctx.moveTo(sm.x, sm.y); ctx.lineTo(em.x, em.y); ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(su.x, su.y); ctx.lineTo(eu.x, eu.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sl.x, sl.y); ctx.lineTo(el.x, el.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      drawChannelFill(ctx, su, eu, sl, el, color);
      break;
    }
    case 'channel_flat': {
      if (pts.length < 2) { ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke(); break; }
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, b.y); ctx.lineTo(W, b.y); ctx.stroke();
      // Fill
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = color;
      ctx.fillRect(0, Math.min(a.y, b.y), W, Math.abs(b.y - a.y));
      ctx.restore();
      // Price labels
      ctx.setLineDash([]);
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = stroke; ctx.textAlign = 'right';
      ctx.fillText(d.points[0].price.toFixed(5), W - 6, a.y - 4);
      ctx.fillText(d.points[1].price.toFixed(5), W - 6, b.y - 4);
      break;
    }
    case 'channel_regression': {
      if (pts.length < 2) break;
      const stdDev  = d.style?.stdDev ?? 0;
      const pxBand  = toPixel(d.points[0].time, d.points[0].price + stdDev);
      const pixBand = pxBand ? Math.abs(a.y - pxBand.y) : 0;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const nx = len > 0 ? pixBand * (-dy) / len : 0;
      const ny = len > 0 ? pixBand * dx  / len : 0;
      // Midline
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      // Bands
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x+nx, a.y+ny); ctx.lineTo(b.x+nx, b.y+ny); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(a.x-nx, a.y-ny); ctx.lineTo(b.x-nx, b.y-ny); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x+nx, a.y+ny); ctx.lineTo(b.x+nx, b.y+ny);
      ctx.lineTo(b.x-nx, b.y-ny); ctx.lineTo(a.x-nx, a.y-ny);
      ctx.closePath(); ctx.fill(); ctx.restore();
      break;
    }
    case 'channel_disjoint': {
      const [p1, p2, p3, p4] = pts;
      if (p1 && p2) {
        const { start: s1, end: e1 } = lineEndPoints(p1.x, p1.y, p2.x, p2.y, W, H);
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
      }
      if (p3 && p4) {
        const { start: s2, end: e2 } = lineEndPoints(p3.x, p3.y, p4.x, p4.y, W, H);
        ctx.beginPath(); ctx.moveTo(s2.x, s2.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
      }
      break;
    }

    // ── Phase 3 — Formes ────────────────────────────────────────────────
    case 'rect': {
      if (pts.length < 2) break;
      const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
      const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);
      ctx.beginPath();
      ctx.rect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = color;
      ctx.fill(); ctx.restore();
      break;
    }
    case 'ellipse': {
      if (pts.length < 2) break;
      const rx = Math.abs(b.x - a.x), ry = Math.abs(b.y - a.y);
      if (rx < 1 || ry < 1) break;
      ctx.beginPath();
      ctx.ellipse(a.x, a.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = color;
      ctx.fill(); ctx.restore();
      break;
    }
    case 'triangle': {
      const c = pts[2];
      if (!c) {
        if (pts.length >= 2) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        break;
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y); ctx.closePath();
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = color;
      ctx.fill(); ctx.restore();
      break;
    }
    case 'path': {
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      break;
    }
    case 'highlight': {
      if (pts.length < 2) break;
      ctx.save(); ctx.globalAlpha = 0.15; ctx.fillStyle = color;
      ctx.fillRect(0, Math.min(a.y, b.y), W, Math.abs(b.y - a.y));
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, b.y); ctx.lineTo(W, b.y); ctx.stroke();
      break;
    }

    // ── Position longue / courte ────────────────────────────────────────
    case 'position_long':
    case 'position_short': {
      if (!pts[0]) break;
      const entry = pts[0];
      const tp    = pts[1] ?? entry;
      const sl    = pts[2] ?? { x: entry.x, y: entry.y + (entry.y - tp.y) };

      const tpClr = '#26A69A', slClr = '#EF5350';

      ctx.save();
      ctx.globalAlpha = 0.13;
      ctx.fillStyle = tpClr;
      ctx.fillRect(0, Math.min(entry.y, tp.y), W, Math.abs(entry.y - tp.y));
      ctx.fillStyle = slClr;
      ctx.fillRect(0, Math.min(entry.y, sl.y), W, Math.abs(entry.y - sl.y));
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = stroke;
      ctx.beginPath(); ctx.moveTo(0, entry.y); ctx.lineTo(W, entry.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = tpClr;
      ctx.beginPath(); ctx.moveTo(0, tp.y); ctx.lineTo(W, tp.y); ctx.stroke();
      ctx.strokeStyle = slClr;
      ctx.beginPath(); ctx.moveTo(0, sl.y); ctx.lineTo(W, sl.y); ctx.stroke();

      const ep   = d.points[0]?.price ?? 0;
      const tpp  = d.points[1]?.price ?? ep;
      const slp  = d.points[2]?.price ?? ep;
      const tpDist = Math.abs(tpp - ep);
      const slDist = Math.abs(slp - ep);
      const tpPct  = ep > 0 ? (tpDist / ep * 100).toFixed(2) : '0.00';
      const slPct  = ep > 0 ? (slDist / ep * 100).toFixed(2) : '0.00';
      const rr     = slDist > 0 ? (tpDist / slDist).toFixed(1) : '∞';

      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      if (Math.abs(entry.y - tp.y) > 18) {
        ctx.fillStyle = tpClr;
        ctx.fillText(`+${tpPct}%`, W - 6, (entry.y + tp.y) / 2);
      }
      if (Math.abs(entry.y - sl.y) > 18) {
        ctx.fillStyle = slClr;
        ctx.fillText(`-${slPct}%`, W - 6, (entry.y + sl.y) / 2);
      }
      ctx.fillStyle = stroke;
      ctx.textBaseline = 'bottom';
      ctx.fillText(
        `${d.type === 'position_long' ? 'LONG' : 'SHORT'}  R:R ${rr}`,
        W - 6, entry.y - 3,
      );
      ctx.restore();
      break;
    }

    // ── Plage de prix ───────────────────────────────────────────────────
    case 'price_range': {
      if (!pts[0]) break;
      const p1 = pts[0], p2 = pts[1] ?? pts[0];
      const yT = Math.min(p1.y, p2.y), yB = Math.max(p1.y, p2.y);

      ctx.save();
      ctx.globalAlpha = 0.1; ctx.fillStyle = color;
      ctx.fillRect(0, yT, W, yB - yT);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeStyle = stroke;
      ctx.beginPath(); ctx.moveTo(0, p1.y); ctx.lineTo(W, p1.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p2.y); ctx.lineTo(W, p2.y); ctx.stroke();

      const pr1 = d.points[0]?.price ?? 0, pr2 = d.points[1]?.price ?? pr1;
      const diff = Math.abs(pr2 - pr1);
      const pct  = pr1 > 0 ? (diff / pr1 * 100).toFixed(3) : '0.000';
      if (yB - yT > 16) {
        ctx.fillStyle = stroke;
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(`${diff.toFixed(5)}  ${pct}%`, W - 6, (p1.y + p2.y) / 2);
      }
      ctx.restore();
      break;
    }

    // ── Plage de dates ──────────────────────────────────────────────────
    case 'date_range': {
      if (!pts[0]) break;
      const p1 = pts[0], p2 = pts[1] ?? pts[0];
      const xL = Math.min(p1.x, p2.x), xR = Math.max(p1.x, p2.x);

      ctx.save();
      ctx.globalAlpha = 0.1; ctx.fillStyle = color;
      ctx.fillRect(xL, 0, xR - xL, H);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeStyle = stroke;
      ctx.beginPath(); ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p2.x, 0); ctx.lineTo(p2.x, H); ctx.stroke();

      const t1 = d.points[0]?.time ?? 0, t2 = d.points[1]?.time ?? t1;
      if (xR - xL > 30) {
        ctx.fillStyle = stroke;
        ctx.font = 'bold 10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fmtTimeDiff(t1, t2), (p1.x + p2.x) / 2, 10);
      }
      ctx.restore();
      break;
    }

    // ── Plage date + prix ───────────────────────────────────────────────
    case 'datetime_range': {
      if (!pts[0] || !pts[1]) break;
      const p1 = pts[0], p2 = pts[1];
      const xMin = Math.min(p1.x, p2.x), xMax = Math.max(p1.x, p2.x);
      const yMin = Math.min(p1.y, p2.y), yMax = Math.max(p1.y, p2.y);

      ctx.save();
      ctx.globalAlpha = 0.08; ctx.fillStyle = color;
      ctx.fillRect(xMin, yMin, xMax - xMin, yMax - yMin);
      ctx.globalAlpha = 1;

      ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeStyle = stroke;
      ctx.strokeRect(xMin, yMin, xMax - xMin, yMax - yMin);

      const pr1 = d.points[0]?.price ?? 0, pr2 = d.points[1]?.price ?? pr1;
      const t1  = d.points[0]?.time  ?? 0, t2  = d.points[1]?.time  ?? t1;
      const diff = Math.abs(pr2 - pr1);
      const pct  = pr1 > 0 ? (diff / pr1 * 100).toFixed(2) : '0.00';
      if (xMax - xMin > 40 && yMax - yMin > 20) {
        ctx.fillStyle = stroke;
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(
          `${diff.toFixed(5)} (${pct}%)  ${fmtTimeDiff(t1, t2)}`,
          (p1.x + p2.x) / 2, (p1.y + p2.y) / 2,
        );
      }
      ctx.restore();
      break;
    }
  }

  // Selection handles (anchor points)
  if (selected) {
    ctx.setLineDash([]);
    for (const pt of pts) {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, HANDLE, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  ctx.restore();
}

// ── Render draft (in-progress placement) ─────────────────────────────────
function renderDraft(ctx, draft, W, H, toPixel) {
  const { type, points, preview } = draft;
  if (!points.length) return;

  ctx.save();
  ctx.strokeStyle = '#2196F3';
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.setLineDash([5, 4]);

  const a = points[0];
  const b = preview ?? a;

  // Show placed anchors as dots
  for (const p of points) {
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2196F3'; ctx.fill();
    ctx.setLineDash([5, 4]);
  }

  // Preview line(s) from last placed point to mouse
  const last = points[points.length - 1];

  switch (type) {
    // 2-point tools
    case 'segment': case 'arrow': case 'ruler':
    case 'channel_flat': case 'channel_regression':
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      break;
    case 'ray': {
      const end = rayEndPoint(a.x, a.y, b.x, b.y, W, H);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      break;
    }
    case 'trendline': {
      const { start, end } = lineEndPoints(a.x, a.y, b.x, b.y, W, H);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
      break;
    }
    case 'hline':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      break;
    case 'vline':
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H); ctx.stroke();
      break;
    case 'crossline':
      ctx.beginPath();
      ctx.moveTo(0, a.y); ctx.lineTo(W, a.y);
      ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H);
      ctx.stroke();
      break;

    // 3-point tools: channel_parallel / channel_raff
    case 'channel_parallel':
    case 'channel_raff':
      if (points.length === 1) {
        // First segment preview: P1 → mouse
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (points.length >= 2) {
        const [p1, p2] = points;
        // First line (extended)
        const { start: s1, end: e1 } = lineEndPoints(p1.x, p1.y, p2.x, p2.y, W, H);
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
        // Second line parallel through mouse
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const off = perpOffset(b.x, b.y, p1.x, p1.y, dx, dy);
          const nx = off * (-dy) / len, ny = off * dx / len;
          const { start: s2, end: e2 } = lineEndPoints(p1.x+nx, p1.y+ny, p2.x+nx, p2.y+ny, W, H);
          ctx.beginPath(); ctx.moveTo(s2.x, s2.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
          if (type === 'channel_raff') {
            // Also mirror the offset on the other side
            const { start: s3, end: e3 } = lineEndPoints(p1.x-nx, p1.y-ny, p2.x-nx, p2.y-ny, W, H);
            ctx.beginPath(); ctx.moveTo(s3.x, s3.y); ctx.lineTo(e3.x, e3.y); ctx.stroke();
          }
        }
      }
      break;

    // 4-point tool: channel_disjoint
    case 'channel_disjoint':
      if (points.length <= 2) {
        // Drawing first segment
        const { start: s1, end: e1 } = lineEndPoints(a.x, a.y, b.x, b.y, W, H);
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
      } else {
        // First segment completed, drawing second
        const { start: s1, end: e1 } = lineEndPoints(points[0].x, points[0].y, points[1].x, points[1].y, W, H);
        ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(e1.x, e1.y); ctx.stroke();
        const { start: s2, end: e2 } = lineEndPoints(points[2].x, points[2].y, b.x, b.y, W, H);
        ctx.beginPath(); ctx.moveTo(s2.x, s2.y); ctx.lineTo(e2.x, e2.y); ctx.stroke();
      }
      break;

    // Phase 3 — Formes draft
    case 'rect':
      ctx.beginPath();
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.stroke();
      break;
    case 'ellipse': {
      const rx = Math.abs(b.x - a.x), ry = Math.abs(b.y - a.y);
      if (rx >= 1 && ry >= 1) {
        ctx.beginPath();
        ctx.ellipse(a.x, a.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'triangle':
      if (points.length === 1) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      } else if (points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(points[1].x, points[1].y);
        ctx.lineTo(b.x, b.y); ctx.closePath();
        ctx.stroke();
      }
      break;
    case 'path':
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    case 'highlight':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, b.y); ctx.lineTo(W, b.y); ctx.stroke();
      break;

    // ── Position longue / courte (drag: a=entry, b=TP preview) ─────────
    case 'position_long':
    case 'position_short': {
      const sl = { x: b.x, y: a.y + (a.y - b.y) }; // SL symétrique
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#26A69A';
      ctx.fillRect(0, Math.min(a.y, b.y), W, Math.abs(a.y - b.y));
      ctx.fillStyle = '#EF5350';
      ctx.fillRect(0, Math.min(a.y, sl.y), W, Math.abs(a.y - sl.y));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#2196F3'; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#26A69A';
      ctx.beginPath(); ctx.moveTo(0, b.y); ctx.lineTo(W, b.y); ctx.stroke();
      ctx.strokeStyle = '#EF5350';
      ctx.beginPath(); ctx.moveTo(0, sl.y); ctx.lineTo(W, sl.y); ctx.stroke();
      ctx.restore();
      break;
    }

    // ── Plage de prix ───────────────────────────────────────────────────
    case 'price_range':
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(W, a.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, b.y); ctx.lineTo(W, b.y); ctx.stroke();
      break;

    // ── Plage de dates ──────────────────────────────────────────────────
    case 'date_range':
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x, 0); ctx.lineTo(b.x, H); ctx.stroke();
      break;

    // ── Plage date + prix ───────────────────────────────────────────────
    case 'datetime_range':
      ctx.beginPath();
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.stroke();
      break;
  }

  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────
function hitTest(d, px, py, toPixel, W, H) {
  const pts = d.points.map(p => toPixel(p.time, p.price)).filter(Boolean);
  if (!pts.length) return false;
  const a = pts[0], b = pts[1] ?? pts[0];

  switch (d.type) {
    case 'segment': case 'arrow': case 'ruler':
    case 'channel_regression':
      return distToSegment(px, py, a.x, a.y, b.x, b.y) < HIT;
    case 'ray': {
      const end = rayEndPoint(a.x, a.y, b.x, b.y, W, H);
      return distToSegment(px, py, a.x, a.y, end.x, end.y) < HIT;
    }
    case 'trendline': {
      const { start, end } = lineEndPoints(a.x, a.y, b.x, b.y, W, H);
      return distToSegment(px, py, start.x, start.y, end.x, end.y) < HIT;
    }
    case 'hline':     return Math.abs(py - a.y) < HIT;
    case 'vline':     return Math.abs(px - a.x) < HIT;
    case 'crossline': return Math.abs(py - a.y) < HIT || Math.abs(px - a.x) < HIT;
    case 'channel_flat':
      return Math.abs(py - a.y) < HIT || Math.abs(py - b.y) < HIT;
    case 'channel_parallel':
    case 'channel_raff': {
      if (pts.length < 3) return distToSegment(px, py, a.x, a.y, b.x, b.y) < HIT;
      const ch = channelOffset(pts, W, H);
      if (!ch) return false;
      const { nx, ny } = ch;
      const { start: s1, end: e1 } = lineEndPoints(a.x,      a.y,      b.x,      b.y,      W, H);
      const { start: s2, end: e2 } = lineEndPoints(a.x + nx, a.y + ny, b.x + nx, b.y + ny, W, H);
      const hit1 = distToSegment(px, py, s1.x, s1.y, e1.x, e1.y) < HIT;
      const hit2 = distToSegment(px, py, s2.x, s2.y, e2.x, e2.y) < HIT;
      if (d.type === 'channel_raff') {
        const { start: s3, end: e3 } = lineEndPoints(a.x - nx, a.y - ny, b.x - nx, b.y - ny, W, H);
        return hit1 || hit2 || distToSegment(px, py, s3.x, s3.y, e3.x, e3.y) < HIT;
      }
      return hit1 || hit2;
    }
    case 'channel_disjoint': {
      const [p1, p2, p3, p4] = pts;
      if (p1 && p2) {
        const { start: s1, end: e1 } = lineEndPoints(p1.x, p1.y, p2.x, p2.y, W, H);
        if (distToSegment(px, py, s1.x, s1.y, e1.x, e1.y) < HIT) return true;
      }
      if (p3 && p4) {
        const { start: s2, end: e2 } = lineEndPoints(p3.x, p3.y, p4.x, p4.y, W, H);
        if (distToSegment(px, py, s2.x, s2.y, e2.x, e2.y) < HIT) return true;
      }
      return false;
    }
    case 'rect': {
      if (pts.length < 2) return false;
      const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
      const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);
      return (
        distToSegment(px, py, xMin, yMin, xMax, yMin) < HIT ||
        distToSegment(px, py, xMax, yMin, xMax, yMax) < HIT ||
        distToSegment(px, py, xMax, yMax, xMin, yMax) < HIT ||
        distToSegment(px, py, xMin, yMax, xMin, yMin) < HIT
      );
    }
    case 'ellipse': {
      if (pts.length < 2) return false;
      const rx = Math.abs(b.x - a.x), ry = Math.abs(b.y - a.y);
      if (rx < 1 || ry < 1) return false;
      const dx = (px - a.x) / rx, dy = (py - a.y) / ry;
      return Math.abs(Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry) < HIT;
    }
    case 'triangle': {
      if (pts.length < 3) return distToSegment(px, py, a.x, a.y, b.x, b.y) < HIT;
      const c = pts[2];
      return (
        distToSegment(px, py, a.x, a.y, b.x, b.y) < HIT ||
        distToSegment(px, py, b.x, b.y, c.x, c.y) < HIT ||
        distToSegment(px, py, c.x, c.y, a.x, a.y) < HIT
      );
    }
    case 'path': {
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(px, py, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y) < HIT) return true;
      }
      return false;
    }
    case 'highlight': {
      if (pts.length < 2) return Math.abs(py - a.y) < HIT;
      const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);
      return py >= yMin - HIT && py <= yMax + HIT;
    }
    case 'position_long':
    case 'position_short': {
      if (!pts[0]) return false;
      const entry = pts[0];
      const tp  = pts[1] ?? entry;
      const sl  = pts[2] ?? { x: entry.x, y: entry.y + (entry.y - tp.y) };
      return Math.abs(py - entry.y) < HIT ||
             Math.abs(py - tp.y)    < HIT ||
             Math.abs(py - sl.y)    < HIT;
    }
    case 'price_range':
      return Math.abs(py - a.y) < HIT || Math.abs(py - (pts[1]?.y ?? a.y)) < HIT;
    case 'date_range':
      return Math.abs(px - a.x) < HIT || Math.abs(px - (pts[1]?.x ?? a.x)) < HIT;
    case 'datetime_range': {
      if (pts.length < 2) return false;
      const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
      const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);
      return (
        distToSegment(px, py, xMin, yMin, xMax, yMin) < HIT ||
        distToSegment(px, py, xMax, yMin, xMax, yMax) < HIT ||
        distToSegment(px, py, xMax, yMax, xMin, yMax) < HIT ||
        distToSegment(px, py, xMin, yMax, xMin, yMin) < HIT
      );
    }
    default: return false;
  }
}

function hitHandle(d, px, py, toPixel) {
  const pts = d.points.map(p => toPixel(p.time, p.price)).filter(Boolean);
  for (let i = 0; i < pts.length; i++) {
    if (Math.hypot(px - pts[i].x, py - pts[i].y) < HANDLE + 4) return i;
  }
  return -1;
}

// ── Component ─────────────────────────────────────────────────────────────
export default function DrawingCanvas({
  chartRef,
  seriesRef,
  containerRef,
  candles,
  drawings,
  activeTool,
  selectedId,
  onDrawingAdd,
  onDrawingUpdate,
  onDrawingRemove,
  onDrawingSelect,
  onRedrawTrigger,
}) {
  const canvasRef   = useRef(null);
  const draftRef    = useRef(null);
  const draggingRef = useRef(null);
  const hoverIdRef  = useRef(null);
  const dprRef      = useRef(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const drawingsRef   = useRef(drawings);
  const selectedIdRef = useRef(selectedId);
  const activeToolRef = useRef(activeTool);
  const candlesRef    = useRef(candles);
  useEffect(() => { drawingsRef.current   = drawings;   }, [drawings]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { candlesRef.current    = candles;    }, [candles]);

  // ── Coordinate helpers ─────────────────────────────────────────────
  const toPixel = useCallback((time, price) => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(time);
    const y = series.priceToCoordinate(price);
    if (x == null || y == null) return null;
    return { x, y };
  }, [chartRef, seriesRef]);

  const toLogical = useCallback((x, y) => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return null;
    const time  = chart.timeScale().coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price };
  }, [chartRef, seriesRef]);

  // ── Canvas pointer-events ─────────────────────────────────────────
  const updatePointerEvents = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.style.pointerEvents =
      (activeToolRef.current !== null || draggingRef.current !== null) ? 'auto' : 'none';
  }, []);

  useEffect(() => { updatePointerEvents(); }, [activeTool, updatePointerEvents]);

  // ── Redraw ─────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = dprRef.current;
    const W   = canvas.width  / dpr;
    const H   = canvas.height / dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    for (const d of drawingsRef.current) {
      renderDrawing(ctx, d, W, H, toPixel, selectedIdRef.current === d.id, hoverIdRef.current === d.id);
    }
    if (draftRef.current) renderDraft(ctx, draftRef.current, W, H, toPixel);
  }, [toPixel]);

  // Register redraw with parent (TradingChart calls it on pan/zoom)
  useEffect(() => {
    onRedrawTrigger?.(redraw);
    return () => { onRedrawTrigger?.(null); };
  }, [redraw, onRedrawTrigger]);

  useEffect(() => { redraw(); }, [drawings, selectedId, activeTool, redraw]);

  // ── Resize observer ────────────────────────────────────────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(([entry]) => {
      const dpr = dprRef.current;
      const { width, height } = entry.contentRect;
      canvas.width  = Math.round(width  * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width  = width  + 'px';
      canvas.style.height = height + 'px';
      redraw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw, containerRef]);

  // ── CURSOR MODE: hover + click detection via container ────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const getXY = (e) => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const dims = () => {
      const r = container.getBoundingClientRect();
      return { W: r.width, H: r.height };
    };

    const onMouseMove = (e) => {
      if (activeToolRef.current !== null || draggingRef.current) return;
      const { x, y } = getXY(e);
      const { W, H } = dims();
      const hit = [...drawingsRef.current].reverse().find(d => hitTest(d, x, y, toPixel, W, H));
      const newId = hit?.id ?? null;
      if (newId !== hoverIdRef.current) {
        hoverIdRef.current = newId;
        canvas.style.pointerEvents = newId ? 'auto' : 'none';
        container.style.cursor     = newId ? 'pointer' : '';
        redraw();
      }
    };

    const onPointerDown = (e) => {
      if (e.button !== 0 || activeToolRef.current !== null) return;
      const { x, y } = getXY(e);
      const { W, H } = dims();
      const cur = drawingsRef.current;
      // Handle on selected drawing
      const sel = cur.find(d => d.id === selectedIdRef.current);
      if (sel) {
        const hi = hitHandle(sel, x, y, toPixel);
        if (hi >= 0) {
          draggingRef.current = { id: sel.id, handleIdx: hi, startX: x, startY: y, origPoints: sel.points.map(p => ({...p})) };
          canvas.style.pointerEvents = 'auto';
          updatePointerEvents();
          return;
        }
      }
      const hit = [...cur].reverse().find(d => hitTest(d, x, y, toPixel, W, H));
      if (hit) {
        onDrawingSelect(hit.id);
        draggingRef.current = { id: hit.id, handleIdx: -1, startX: x, startY: y, origPoints: hit.points.map(p => ({...p})) };
        canvas.style.pointerEvents = 'auto';
        updatePointerEvents();
      } else {
        onDrawingSelect(null);
      }
    };

    container.addEventListener('mousemove',   onMouseMove);
    container.addEventListener('pointerdown', onPointerDown);
    return () => {
      container.removeEventListener('mousemove',   onMouseMove);
      container.removeEventListener('pointerdown', onPointerDown);
    };
  }, [toPixel, redraw, containerRef, onDrawingSelect, updatePointerEvents]);

  // ── DRAG: move/handle drag on canvas ──────────────────────────────
  useEffect(() => {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const getXY = (e) => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerMove = (e) => {
      if (!draggingRef.current || activeToolRef.current !== null) return;
      const { x, y } = getXY(e);
      const { id, handleIdx, startX, startY, origPoints } = draggingRef.current;
      if (handleIdx >= 0) {
        const l = toLogical(x, y);
        if (!l) return;
        onDrawingUpdate(id, { points: origPoints.map((p, i) => i === handleIdx ? l : {...p}) });
      } else {
        const dx = x - startX, dy = y - startY;
        const newPts = origPoints.map(p => {
          const px = toPixel(p.time, p.price);
          return (px ? toLogical(px.x + dx, px.y + dy) : null) ?? p;
        });
        onDrawingUpdate(id, { points: newPts });
      }
    };

    const onPointerUp = () => {
      if (!draggingRef.current || activeToolRef.current !== null) return;
      draggingRef.current = null;
      canvas.style.pointerEvents = hoverIdRef.current ? 'auto' : 'none';
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup',   onPointerUp);
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup',   onPointerUp);
    };
  }, [toPixel, toLogical, onDrawingUpdate, containerRef]);

  // ── DRAWING MODE: canvas captures all events ───────────────────────
  useEffect(() => {
    if (activeTool === null) return;
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const getXY = (e) => {
      const r = container.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const dims = () => {
      const r = container.getBoundingClientRect();
      return { W: r.width, H: r.height };
    };

    const required = getRequiredPoints(activeTool);

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      const { x, y } = getXY(e);
      const logical   = toLogical(x, y);
      if (!logical) return;

      // Drag-based tools: entry on pointerdown, TP on pointerup (SL mirrored)
      if (DRAG_TOOLS.has(activeTool)) {
        draftRef.current = { type: activeTool, points: [{ x, y, ...logical }], preview: { x, y }, isDrag: true };
        redraw();
        return;
      }

      // Single-click tools
      if (required === 1) {
        onDrawingAdd(activeTool, [logical]);
        draftRef.current = null;
        redraw();
        return;
      }

      const draft = draftRef.current;

      if (!draft) {
        draftRef.current = { type: activeTool, points: [{ x, y, ...logical }], preview: { x, y } };
      } else if (draft.points.length < required - 1) {
        // Intermediate point
        draftRef.current = { ...draft, points: [...draft.points, { x, y, ...logical }], preview: { x, y } };
      } else {
        // Final point → complete drawing
        const allLogical = [
          ...draft.points.map(p => ({ time: p.time, price: p.price })),
          logical,
        ];

        if (activeTool === 'channel_regression') {
          const t1  = allLogical[0].time, t2 = allLogical[1].time;
          const reg = linearRegression(candlesRef.current ?? [], t1, t2);
          if (reg) {
            onDrawingAdd(activeTool, [
              { time: Math.min(t1, t2), price: reg.startPrice },
              { time: Math.max(t1, t2), price: reg.endPrice },
            ], { stdDev: reg.stdDev });
          }
        } else {
          onDrawingAdd(activeTool, allLogical);
        }
        draftRef.current = null;
      }
      redraw();
    };

    const onPointerMove = (e) => {
      const { x, y } = getXY(e);
      canvas.style.cursor = 'crosshair';
      if (draftRef.current) {
        draftRef.current = { ...draftRef.current, preview: { x, y } };
        redraw();
      } else if (required === 1) {
        // Ghost preview for single-click tools
        const logical = toLogical(x, y);
        if (logical) {
          draftRef.current = { type: activeTool, points: [{ x, y, ...logical }], preview: { x, y } };
          redraw();
        }
      }
    };

    const onPointerLeave = () => {
      if (required === 1) { draftRef.current = null; redraw(); }
    };

    const onDblClick = () => {
      const draft = draftRef.current;
      if (activeTool === 'path' && draft && draft.points.length >= 2) {
        // 2nd click of dblclick already added a point — remove it, then complete
        const pts = draft.points.slice(0, -1);
        onDrawingAdd('path', pts.map(p => ({ time: p.time, price: p.price })));
      }
      draftRef.current = null;
      redraw();
    };

    // Forward wheel to LWC so zoom works in drawing mode
    const onWheel = (e) => {
      const lwc = containerRef.current?.querySelector('canvas');
      if (!lwc) return;
      e.preventDefault();
      lwc.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true,
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
      }));
    };

    // Finalize drag-based tools (position_long / position_short) on pointerup
    const onPointerUp = (e) => {
      const draft = draftRef.current;
      if (!draft?.isDrag) return;
      const { x, y } = getXY(e);
      const tp = toLogical(x, y);
      if (tp && draft.points[0]) {
        const entry = { time: draft.points[0].time, price: draft.points[0].price };
        const slPrice = entry.price - (tp.price - entry.price);
        onDrawingAdd(activeTool, [
          entry,
          { time: tp.time,    price: tp.price  },
          { time: entry.time, price: slPrice    },
        ]);
      }
      draftRef.current = null;
      redraw();
    };

    canvas.addEventListener('pointerdown',  onPointerDown);
    canvas.addEventListener('pointerup',    onPointerUp);
    canvas.addEventListener('pointermove',  onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('dblclick',     onDblClick);
    canvas.addEventListener('wheel',        onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown',  onPointerDown);
      canvas.removeEventListener('pointerup',    onPointerUp);
      canvas.removeEventListener('pointermove',  onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick',     onDblClick);
      canvas.removeEventListener('wheel',        onWheel);
      draftRef.current = null;
    };
  }, [activeTool, toLogical, redraw, onDrawingAdd, containerRef]);

  // ── Keyboard ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { draftRef.current = null; redraw(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === document.body) {
        if (selectedIdRef.current) onDrawingRemove(selectedIdRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redraw, onDrawingRemove]);

  return (
    <canvas
      ref={canvasRef}
      data-drawing-layer=""
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 10 }}
    />
  );
}
