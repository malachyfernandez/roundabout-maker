import { type Vec2, add, sub, scale, norm, perpLeft, dot, len } from '../math/vector';
import { removeOffsetLoops, subdivideSharpTurns } from '../math/polyline';
import { type ResolvedSegment } from '../core/solver';
import { type CapLine } from '../core/routes';
import { type Polyline, type Arc, type Line, arcPoint, linePoint, arcTangent } from '../geometry/primitives';

const MAX_OFFSET_TURN = Math.PI / 3;
const WIDTH_EPS = .05;
const CAP_EPS = 1e-6;

type OffsetSample = { p: Vec2; normal: Vec2; width: number };
export type SurfaceRun = { center: Vec2[]; left: Vec2[]; right: Vec2[]; widths: number[] };
export type SegmentSurface = { runs: SurfaceRun[]; d: string };

function widthAtFraction(seg: ResolvedSegment, t: number, pointCount: number) {
  if (seg.widths) {
    const index = Math.floor(t);
    const frac = t - index;
    const start = seg.widths[index] ?? seg.widths.at(-1) ?? 0;
    const end = seg.widths[index + 1] ?? seg.widths.at(-1) ?? 0;
    return start + (end - start) * frac;
  }
  return seg.wStart + (seg.wEnd - seg.wStart) * t / Math.max(1, pointCount - 1);
}

function genericSamples(seg: ResolvedSegment): OffsetSample[] {
  const pts: OffsetSample[] = [];
  if (seg.geom.kind === 'line') {
    const line = seg.geom as Line;
    const p0 = linePoint(line, line.t0);
    const p1 = linePoint(line, line.t1);
    const normal = norm(perpLeft(line.u));
    pts.push({ p: p0, normal, width: widthAtFraction(seg, 0, 2) });
    pts.push({ p: p1, normal, width: widthAtFraction(seg, 1, 2) });
  } else if (seg.geom.kind === 'arc') {
    const arc = seg.geom as Arc;
    const diff = Math.abs(arc.a1 - arc.a0);
    const steps = Math.max(2, Math.ceil(diff / (5 * Math.PI / 180)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = arc.a0 + t * (arc.a1 - arc.a0);
      const tangent = arcTangent(arc, angle);
      pts.push({ p: arcPoint(arc, angle), normal: norm(perpLeft(tangent)), width: widthAtFraction(seg, i, steps + 1) });
    }
  } else if (seg.geom.kind === 'polyline') {
    const poly = seg.geom as Polyline;
    if (poly.points.length < 2) return pts;
    const centerline = removeOffsetLoops(poly.points);
    const samples = subdivideSharpTurns(centerline, MAX_OFFSET_TURN);
    const dense = samples.map(sample => sample.p);
    for (let i = 0; i < dense.length; i++) {
      let dir: Vec2;
      if (i === 0) dir = sub(dense[1], dense[0]);
      else if (i === dense.length - 1) dir = sub(dense[i], dense[i - 1]);
      else dir = sub(dense[i + 1], dense[i - 1]);
      pts.push({ p: dense[i], normal: norm(perpLeft(dir)), width: widthAtFraction(seg, samples[i].t, poly.points.length) });
    }
  }
  return pts;
}

function capDistance(cap: CapLine, point: Vec2) {
  return dot(sub(point, cap.p), cap.outward);
}

function capIntersection(a: Vec2, b: Vec2, cap: CapLine): Vec2 {
  const direction = sub(b, a);
  const denominator = dot(direction, cap.outward);
  if (Math.abs(denominator) < CAP_EPS) return sub(a, scale(cap.outward, capDistance(cap, a)));
  const t = -capDistance(cap, a) / denominator;
  return add(a, scale(direction, t));
}

function boundEdgeAtCap(edge: Vec2[], cap: CapLine, atStart: boolean): Vec2[] {
  if (edge.length < 2) return edge;
  const result = [...edge];
  if (atStart) {
    while (result.length > 1 && capDistance(cap, result[0]) > CAP_EPS && capDistance(cap, result[1]) > CAP_EPS) result.shift();
    if (result.length < 2) return result;
    result[0] = capIntersection(result[0], result[1], cap);
    for (let i = 1; i < result.length; i++) {
      if (Math.abs(capDistance(cap, result[i])) < CAP_EPS) result.splice(i--, 1);
    }
  } else {
    while (result.length > 1 && capDistance(cap, result.at(-1)!) > CAP_EPS && capDistance(cap, result.at(-2)!) > CAP_EPS) result.pop();
    if (result.length < 2) return result;
    result[result.length - 1] = capIntersection(result.at(-2)!, result.at(-1)!, cap);
    for (let i = 0; i < result.length - 1; i++) {
      if (Math.abs(capDistance(cap, result[i])) < CAP_EPS) result.splice(i--, 1);
    }
  }
  return result;
}

function cleanEdgeInterior(edge: Vec2[]): Vec2[] {
  if (edge.length <= 4) return edge;
  return [edge[0], ...removeOffsetLoops(edge.slice(1, -1)), edge.at(-1)!];
}

function samePoint(a: Vec2, b: Vec2) {
  return len(sub(a, b)) < 1e-7;
}

function dedupe(points: Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    if (!result.length || !samePoint(result.at(-1)!, point)) result.push(point);
  }
  return result;
}

function pathFromRun(run: SurfaceRun): string {
  const polygon = dedupe([...run.left, ...[...run.right].reverse()]);
  if (polygon.length < 3) return '';
  if (samePoint(polygon[0], polygon.at(-1)!)) polygon.pop();
  return `M ${polygon.map(point => `${point.x} ${point.y}`).join(' L ')} Z`;
}

function visibleRuns(center: Vec2[], left: Vec2[], right: Vec2[], widths: number[]): SurfaceRun[] {
  const runs: SurfaceRun[] = [];
  for (let index = 0; index < center.length; index++) {
    if ((widths[index] ?? 0) <= WIDTH_EPS) continue;
    const first = index;
    while (index + 1 < center.length && (widths[index + 1] ?? 0) > WIDTH_EPS) index++;
    const last = index;
    const lo = Math.max(0, first - 1);
    const hi = Math.min(center.length - 1, last + 1);
    const run: SurfaceRun = {
      center: center.slice(lo, hi + 1),
      left: left.slice(lo, hi + 1),
      right: right.slice(lo, hi + 1),
      widths: widths.slice(lo, hi + 1)
    };
    if ((run.widths[0] ?? 0) <= WIDTH_EPS) {
      run.left[0] = run.center[0];
      run.right[0] = run.center[0];
    }
    if ((run.widths.at(-1) ?? 0) <= WIDTH_EPS) {
      run.left[run.left.length - 1] = run.center.at(-1)!;
      run.right[run.right.length - 1] = run.center.at(-1)!;
    }
    run.left = cleanEdgeInterior(dedupe(run.left));
    run.right = cleanEdgeInterior(dedupe(run.right));
    runs.push(run);
  }
  return runs;
}

export function generateSegmentSurface(seg: ResolvedSegment): SegmentSurface {
  let runs: SurfaceRun[];
  if (seg.geom.kind === 'polyline' && seg.boundaries) {
    const poly = seg.geom as Polyline;
    const count = Math.min(poly.points.length, seg.boundaries.left.length, seg.boundaries.right.length, seg.widths?.length ?? Infinity);
    runs = visibleRuns(
      poly.points.slice(0, count),
      seg.boundaries.left.slice(0, count),
      seg.boundaries.right.slice(0, count),
      (seg.widths ?? []).slice(0, count)
    );
    if (runs.length && seg.startCap && runs[0].center[0] === poly.points[0] && (runs[0].widths[0] ?? 0) > WIDTH_EPS) {
      runs[0].left = boundEdgeAtCap(runs[0].left, seg.startCap, true);
      runs[0].right = boundEdgeAtCap(runs[0].right, seg.startCap, true);
    }
    const lastRun = runs.at(-1);
    if (lastRun && seg.endCap && lastRun.center.at(-1) === poly.points.at(-1) && (lastRun.widths.at(-1) ?? 0) > WIDTH_EPS) {
      lastRun.left = boundEdgeAtCap(lastRun.left, seg.endCap, false);
      lastRun.right = boundEdgeAtCap(lastRun.right, seg.endCap, false);
    }
  } else {
    const samples = genericSamples(seg);
    runs = visibleRuns(
      samples.map(sample => sample.p),
      samples.map(sample => add(sample.p, scale(sample.normal, sample.width / 2))),
      samples.map(sample => sub(sample.p, scale(sample.normal, sample.width / 2))),
      samples.map(sample => sample.width)
    );
    if (runs.length && seg.startCap && (runs[0].widths[0] ?? 0) > WIDTH_EPS) {
      runs[0].left = boundEdgeAtCap(runs[0].left, seg.startCap, true);
      runs[0].right = boundEdgeAtCap(runs[0].right, seg.startCap, true);
    }
    const lastRun = runs.at(-1);
    if (lastRun && seg.endCap && (lastRun.widths.at(-1) ?? 0) > WIDTH_EPS) {
      lastRun.left = boundEdgeAtCap(lastRun.left, seg.endCap, false);
      lastRun.right = boundEdgeAtCap(lastRun.right, seg.endCap, false);
    }
  }
  return { runs, d: runs.map(pathFromRun).filter(Boolean).join(' ') };
}

const surfaceCache = new WeakMap<ResolvedSegment, SegmentSurface>();

export function segmentSurface(seg: ResolvedSegment): SegmentSurface {
  const cached = surfaceCache.get(seg);
  if (cached) return cached;
  const surface = generateSegmentSurface(seg);
  surfaceCache.set(seg, surface);
  return surface;
}

export function segmentEdgeRuns(seg: ResolvedSegment, side: 'left' | 'right'): Vec2[][] {
  return segmentSurface(seg).runs.map(run => run[side]);
}

export function generateVariableWidthPath(seg: ResolvedSegment): string {
  return segmentSurface(seg).d;
}
