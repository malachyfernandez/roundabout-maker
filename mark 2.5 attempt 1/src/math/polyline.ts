import { type Vec2, add, cross, dot, len, perpLeft, scale, sub } from './vector';
import { evaluateSpline } from './spline';

// When a smooth centerline is offset by more than its local radius of
// curvature (a turn tighter than the offset distance), the offset polyline
// folds back on itself and renders as a knot/spike on the inside of the
// curve. This splices out those fold-over loops, replacing each with the
// point where the fold crosses itself, and collapses the spikes left where
// a fold doubles back without quite crossing. Polylines without folds are
// returned unchanged.
const CROSS_EPS = 1e-9;
const MAX_SPLICES = 64;
const REVERSAL_COS = -0.9;
const RETRACE_RATIO = 0.5;

function segmentCrossing(p: Vec2, q: Vec2, r: Vec2, s: Vec2): Vec2 | null {
  const pq = sub(q, p);
  const rs = sub(s, r);
  const denom = cross(pq, rs);
  if (Math.abs(denom) < CROSS_EPS) return null;
  const pr = sub(r, p);
  const t = cross(pr, rs) / denom;
  const u = cross(pr, pq) / denom;
  // Strictly interior crossings only: endpoint touches are cusps/tangents,
  // and splicing those would corrupt valid geometry.
  if (t <= CROSS_EPS || t >= 1 - CROSS_EPS || u <= CROSS_EPS || u >= 1 - CROSS_EPS) return null;
  return add(p, scale(pq, t));
}

function spliceFirstLoop(points: Vec2[]): Vec2[] | null {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      const hit = segmentCrossing(points[i], points[i + 1], points[j], points[j + 1]);
      if (!hit) continue;
      return [...points.slice(0, i + 1), hit, ...points.slice(j + 1)];
    }
  }
  return null;
}

// A fold tip whose strands do not cross still renders as a wedge because the
// return strand lies on top of the outgoing one. The tip is the vertex where
// the path reverses (~180° turn) and doubles back over itself; dropping the
// tip bridges the tiny base and lets repeated passes eat the whole overlap.
function collapseFirstSpike(points: Vec2[]): Vec2[] | null {
  for (let k = 1; k < points.length - 1; k++) {
    const a = sub(points[k], points[k - 1]);
    const b = sub(points[k + 1], points[k]);
    const la = len(a);
    const lb = len(b);
    if (la < CROSS_EPS || lb < CROSS_EPS) continue;
    if (dot(a, b) / (la * lb) > REVERSAL_COS) continue;
    if (len(sub(points[k + 1], points[k - 1])) > RETRACE_RATIO * Math.min(la, lb)) continue;
    return [...points.slice(0, k), ...points.slice(k + 1)];
  }
  return null;
}

export function removeOffsetLoops(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  let current = points;
  for (let pass = 0; pass < MAX_SPLICES; pass++) {
    const spliced = spliceFirstLoop(current);
    if (spliced) {
      current = spliced;
      continue;
    }
    const collapsed = collapseFirstSpike(current);
    if (!collapsed) return current;
    current = collapsed;
  }
  return current;
}

// Miter-joined offset edges: each vertex lands on the intersection of the
// two adjacent offset lines rather than along the averaged normal. The
// averaged normal undercuts the inside of a bend — a pinched edge visibly
// dips inward — while the miter keeps the true corner on the pinched side
// and bulges outward on the far side, which reads as the smoother
// transition. The miter reach is clamped so near-reversals can't spike.
const MITER_MIN_DENOM = 0.25;

export function miterOffsetEdges(center: Vec2[], halves: number[], fallbackNormal: (index: number) => Vec2): { left: Vec2[]; right: Vec2[] } {
  const segmentDirection = (index: number) => {
    const direction = sub(center[index + 1], center[index]);
    const length = len(direction);
    return length > 1e-9 ? scale(direction, 1 / length) : null;
  };
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let index = 0; index < center.length; index++) {
    const half = halves[index] ?? 0;
    const incoming = index > 0 ? segmentDirection(index - 1) : null;
    const outgoing = index < center.length - 1 ? segmentDirection(index) : null;
    if (!incoming && !outgoing) {
      const fallback = fallbackNormal(index);
      left.push(add(center[index], scale(fallback, half)));
      right.push(sub(center[index], scale(fallback, half)));
      continue;
    }
    const a = perpLeft(incoming ?? outgoing!);
    const b = perpLeft(outgoing ?? incoming!);
    const miter = add(a, b);
    const reach = half / Math.max(MITER_MIN_DENOM, 1 + dot(a, b));
    left.push(add(center[index], scale(miter, reach)));
    right.push(sub(center[index], scale(miter, reach)));
  }
  return { left, right };
}

export type FracPoint = { p: Vec2; t: number };

function turnAt(points: Vec2[], k: number): number {
  const a = sub(points[k], points[k - 1]);
  const b = sub(points[k + 1], points[k]);
  const la = len(a);
  const lb = len(b);
  if (la < CROSS_EPS || lb < CROSS_EPS) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
}

// A polyline sampled too coarsely for its curvature (turns approaching 180°
// between samples) makes point-wise normal offsets zigzag between the
// branches of a cusp. Cutting just the sharp corners onto the implied
// Catmull-Rom curve densifies those regions — the offset then folds smoothly
// where removeOffsetLoops can splice it — while smooth stretches come back
// untouched. Returned points carry their fractional source index so callers
// can keep per-index widths aligned.
export function subdivideSharpTurns(points: Vec2[], maxTurn: number, maxRounds = 4): FracPoint[] {
  if (points.length < 3) return points.map((p, i) => ({ p, t: i }));
  let work = points.map((p, i) => ({ p, t: i }));
  for (let round = 0; round < maxRounds; round++) {
    const sharp = new Set<number>();
    for (let k = 1; k < work.length - 1; k++) {
      if (turnAt(work.map(w => w.p), k) > maxTurn) sharp.add(k);
    }
    if (sharp.size === 0) break;
    const spline = { points: work.map(w => w.p), alpha: 0.5, tension: 0 };
    const count = work.length - 1;
    const next: FracPoint[] = [];
    for (let k = 0; k < work.length; k++) {
      if (!sharp.has(k)) {
        next.push(work[k]);
        continue;
      }
      next.push({ p: evaluateSpline(spline, Math.max(0, (k - 0.5) / count)).p, t: (work[k - 1].t + work[k].t) / 2 });
      next.push({ p: evaluateSpline(spline, Math.min(1, (k + 0.5) / count)).p, t: (work[k].t + work[k + 1].t) / 2 });
    }
    work = next;
  }
  return work;
}
