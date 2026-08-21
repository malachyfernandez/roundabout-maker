import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, type Polyline, arcContainsAngle, arcPoint, arcTangent, linePoint } from '../geometry/primitives';
import { type Vec2, add, angleOf, dot, len, norm, perpLeft, scale, sub } from '../math/vector';

export const MARKING_RULES = [
  'Road pavement is rendered first so every marking remains visible at overlaps.',
  'The lane beside a median receives a solid yellow inner edge line.',
  'The outside edge of each approach and exit receives a solid white edge line.',
  'Boundaries between lanes receive broken white lane-separator lines.',
  'The circulatory pavement union creates its own inner and outer envelopes, independent of ring names or radial ordering.',
  'Every entering lane receives yield teeth immediately before its connector reaches the first live ring; exits never receive yield markings.',
  'Entry arrows point toward the roundabout, exit arrows point away, and ring arrows follow circulation.',
  'Yield markings render above arrows, edges, and separators because they communicate priority.'
] as const;

export type StrokeMarking = {
  kind: 'stroke';
  id: string;
  rule: string;
  points: Vec2[];
  color: string;
  width: number;
  dash?: string;
  priority: number;
};

export type FillMarking = {
  kind: 'fill';
  id: string;
  rule: string;
  points: Vec2[];
  color: string;
  priority: number;
};

export type Marking = StrokeMarking | FillMarking;

export function segmentPoints(segment: ResolvedSegment): Vec2[] {
  if (segment.geom.kind === 'polyline') return (segment.geom as Polyline).points;
  if (segment.geom.kind === 'line') {
    const line = segment.geom as Line;
    return [linePoint(line, line.t0), linePoint(line, line.t1)];
  }
  const arc = segment.geom as Arc;
  const count = Math.max(12, Math.ceil(Math.abs(arc.a1 - arc.a0) / (Math.PI / 36)));
  return Array.from({ length: count + 1 }, (_, index) => arcPoint(arc, arc.a0 + (arc.a1 - arc.a0) * index / count));
}

function widthAt(segment: ResolvedSegment, index: number, pointCount: number) {
  return segment.widths?.[index] ?? segment.wStart + (segment.wEnd - segment.wStart) * index / Math.max(1, pointCount - 1);
}

function normalAt(points: Vec2[], index: number) {
  if (points.length < 2) return { x: 0, y: -1 };
  const direction = index === 0
    ? sub(points[1], points[0])
    : index === points.length - 1
      ? sub(points[index], points[index - 1])
      : sub(points[index + 1], points[index - 1]);
  return norm(perpLeft(direction));
}

function offsetEdge(segment: ResolvedSegment, factor: number) {
  const points = segmentPoints(segment);
  return points.map((point, index) => add(point, scale(normalAt(points, index), widthAt(segment, index, points.length) * factor)));
}

function pointAtDistance(points: Vec2[], distance: number) {
  if (points.length < 2) return { point: points[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  let remaining = distance;
  for (let index = 1; index < points.length; index++) {
    const edge = sub(points[index], points[index - 1]);
    const edgeLength = len(edge);
    if (edgeLength >= remaining) return { point: add(points[index - 1], scale(edge, remaining / Math.max(edgeLength, 1e-9))), tangent: norm(edge) };
    remaining -= edgeLength;
  }
  return { point: points[points.length - 1], tangent: norm(sub(points[points.length - 1], points[points.length - 2])) };
}

function arrowShape(point: Vec2, direction: Vec2, size = 7): Vec2[] {
  const forward = norm(direction);
  const side = norm(perpLeft(forward));
  const back = add(point, scale(forward, -size / 2));
  const neck = add(point, scale(forward, size / 5));
  const tip = add(point, scale(forward, size / 2));
  return [
    add(back, scale(side, size * .12)),
    add(neck, scale(side, size * .12)),
    add(neck, scale(side, size * .32)),
    tip,
    add(neck, scale(side, -size * .32)),
    add(neck, scale(side, -size * .12)),
    add(back, scale(side, -size * .12))
  ];
}

function yieldTeeth(point: Vec2, travel: Vec2, laneWidth: number, id: string): FillMarking[] {
  const forward = norm(travel);
  const across = norm(perpLeft(forward));
  const count = Math.max(2, Math.floor(laneWidth / 3));
  return Array.from({ length: count }, (_, index) => {
    const lateral = (index - (count - 1) / 2) * Math.min(3, laneWidth / count);
    const center = add(point, scale(across, lateral));
    const apex = add(center, scale(forward, -1.8));
    const baseCenter = add(center, scale(forward, 1.1));
    return {
      kind: 'fill',
      id: `${id}_tooth_${index}`,
      rule: MARKING_RULES[5],
      points: [apex, add(baseCenter, scale(across, 1.05)), add(baseCenter, scale(across, -1.05))],
      color: '#f8fafc',
      priority: 50
    };
  });
}

type RadialInterval = { start: number; end: number; ringId: string };

function rayCircleRoots(origin: Vec2, direction: Vec2, center: Vec2, radius: number) {
  const relative = sub(origin, center);
  const b = 2 * dot(relative, direction);
  const c = dot(relative, relative) - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / 2, (-b + root) / 2].filter(value => value > 0);
}

function radialIntervalsForArc(origin: Vec2, direction: Vec2, arc: Arc, width: number, ringId: string): RadialInterval[] {
  const innerRadius = Math.max(.01, arc.r - width / 2);
  const outerRadius = arc.r + width / 2;
  const roots = [0, ...rayCircleRoots(origin, direction, arc.c, innerRadius), ...rayCircleRoots(origin, direction, arc.c, outerRadius)]
    .sort((a, b) => a - b);
  const maxRoot = roots.at(-1) ?? 0;
  roots.push(maxRoot + outerRadius * .1 + 1);
  const intervals: RadialInterval[] = [];
  for (let index = 0; index < roots.length - 1; index++) {
    const start = roots[index];
    const end = roots[index + 1];
    const midpoint = add(origin, scale(direction, (start + end) / 2));
    const radial = sub(midpoint, arc.c);
    const distance = len(radial);
    if (distance < innerRadius - 1e-5 || distance > outerRadius + 1e-5 || !arcContainsAngle(arc, angleOf(radial))) continue;
    intervals.push({ start, end, ringId });
  }
  return intervals;
}

function angularDistance(a: number, b: number) {
  let difference = Math.abs(a - b) % (Math.PI * 2);
  if (difference > Math.PI) difference = Math.PI * 2 - difference;
  return difference;
}

function pushPointRuns(markings: Marking[], values: ({ point: Vec2; status: 'solid' | 'dashed' | 'gap' } | null)[], baseId: string, rule: string, color: string, width: number, priority: number) {
  let run: Vec2[] = [];
  let status: 'solid' | 'dashed' | 'gap' = 'gap';
  const flush = () => {
    if (run.length > 1 && status !== 'gap') markings.push({ kind: 'stroke', id: `${baseId}_${markings.length}`, rule, points: run, color, width, dash: status === 'dashed' ? '3 3' : undefined, priority });
    run = [];
  };
  for (const value of values) {
    if (!value || value.status !== status) {
      flush();
      status = value?.status ?? 'gap';
    }
    if (value) run.push(value.point);
  }
  flush();
}

function buildRingEnvelopeMarkings(segments: ResolvedSegment[]) {
  const markings: Marking[] = [];
  const ringSegments = segments.filter(segment => segment.kind === 'ring-arc' && segment.source.kind === 'ring' && segment.geom.kind === 'arc');
  const centralArcSegments = segments.filter(segment => (segment.kind === 'ring-arc' || segment.kind === 'entry-fillet' || segment.kind === 'exit-fillet') && segment.geom.kind === 'arc');
  if (ringSegments.length === 0) return markings;
  const origin = { x: 0, y: 0 };
  const sampleCount = 720;
  const entryWindows = segments.filter(segment => segment.kind === 'entry-fillet' && segment.geom.kind === 'arc').map(segment => {
    const arc = segment.geom as Arc;
    const setback = Math.min(segment.wEnd / 2 / Math.max(arc.r, 1), Math.abs(arc.a1 - arc.a0) * .4);
    const point = arcPoint(arc, arc.a1 - arc.dir * setback);
    const radius = len(sub(point, origin));
    return { angle: angleOf(sub(point, origin)), halfWidth: Math.max(.025, segment.wEnd / Math.max(radius, 1) * .65) };
  });
  const exitWindows = segments.filter(segment => segment.kind === 'exit-fillet' && segment.geom.kind === 'arc').map(segment => {
    const arc = segment.geom as Arc;
    const advance = Math.min(segment.wStart / 2 / Math.max(arc.r, 1), Math.abs(arc.a1 - arc.a0) * .4);
    const point = arcPoint(arc, arc.a0 + arc.dir * advance);
    const radius = len(sub(point, origin));
    return { angle: angleOf(sub(point, origin)), halfWidth: Math.max(.025, segment.wStart / Math.max(radius, 1) * .6) };
  });
  const outer: ({ point: Vec2; status: 'solid' | 'dashed' | 'gap' } | null)[] = [];
  const inner: ({ point: Vec2; status: 'solid' | 'dashed' | 'gap' } | null)[] = [];
  const separators: ({ point: Vec2; status: 'solid' | 'dashed' | 'gap' } | null)[][] = [];

  for (let index = 0; index <= sampleCount; index++) {
    const angle = index / sampleCount * Math.PI * 2;
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    const byRing = new Map<string, RadialInterval>();
    for (const segment of ringSegments) {
      if (segment.source.kind !== 'ring' || segment.geom.kind !== 'arc') continue;
      const intervals = radialIntervalsForArc(origin, direction, segment.geom as Arc, segment.wStart, segment.source.ringId);
      for (const interval of intervals) {
        const existing = byRing.get(interval.ringId);
        if (!existing) byRing.set(interval.ringId, interval);
        else byRing.set(interval.ringId, { ...existing, start: Math.min(existing.start, interval.start), end: Math.max(existing.end, interval.end) });
      }
    }
    const intervals = [...byRing.values()].sort((a, b) => (a.start + a.end) - (b.start + b.end));
    const centralIntervals = centralArcSegments.flatMap(segment => radialIntervalsForArc(
      origin,
      direction,
      segment.geom as Arc,
      Math.max(segment.wStart, segment.wEnd),
      `${segment.routeId}_${segment.segIndex}`
    ));
    const innerRadius = centralIntervals.length > 0 ? Math.min(...centralIntervals.map(interval => interval.start)) : null;
    if (intervals.length === 0) {
      outer.push(null);
      inner.push(innerRadius === null ? null : { point: add(origin, scale(direction, innerRadius)), status: 'solid' });
      separators.forEach(points => points.push(null));
      continue;
    }
    const outerRadius = Math.max(...intervals.map(interval => interval.end));
    const entry = entryWindows.some(window => angularDistance(angle, window.angle) <= window.halfWidth);
    const exit = exitWindows.some(window => angularDistance(angle, window.angle) <= window.halfWidth);
    outer.push({ point: add(origin, scale(direction, outerRadius)), status: entry ? 'dashed' : exit ? 'gap' : 'solid' });
    inner.push(innerRadius === null ? null : { point: add(origin, scale(direction, innerRadius)), status: 'solid' });
    const boundaryCount = Math.max(0, intervals.length - 1);
    while (separators.length < boundaryCount) separators.push(Array(index).fill(null));
    for (let boundary = 0; boundary < separators.length; boundary++) {
      if (boundary < boundaryCount) {
        const radius = (intervals[boundary].end + intervals[boundary + 1].start) / 2;
        separators[boundary].push({ point: add(origin, scale(direction, radius)), status: 'dashed' });
      } else separators[boundary].push(null);
    }
  }

  pushPointRuns(markings, outer, 'circulatory_outer', 'The outer envelope of all live circulatory pavement is solid white, dashed at entries, and open at exits.', '#f8fafc', .8, 28);
  pushPointRuns(markings, inner, 'central_shape', 'The innermost envelope of all live circulatory pavement forms the central shape and receives a solid yellow line.', '#facc15', .8, 29);
  separators.forEach((points, index) => pushPointRuns(markings, points, `turbo_separator_${index}`, 'Adjacent live circulatory lanes create a dashed separator that follows their changing radial order.', '#f8fafc', .6, 22));
  return markings;
}

export function buildMarkings(config: RoundaboutConfig, segments: ResolvedSegment[]): Marking[] {
  const markings: Marking[] = [];
  const isRHD = config.circulation === 'ccw';
  const roadSegments = segments.filter(segment => segment.source.kind === 'lane');

  for (const segment of roadSegments) {
    if (segment.source.kind !== 'lane') continue;
    const source = segment.source;
    const arm = config.arms.find(candidate => candidate.id === source.armId);
    if (!arm) continue;
    const roadKind = segment.kind === 'entry-line' || segment.kind === 'bypass-entry'
      ? 'entry'
      : segment.kind === 'exit-line' || segment.kind === 'bypass-exit'
        ? 'exit'
        : null;
    if (roadKind) {
      const entry = roadKind === 'entry';
      const sideSign = isRHD ? (entry ? 1 : -1) : (entry ? -1 : 1);
      const laneCount = entry ? arm.lanesIn.length : arm.lanesOut.length;
      const inner = offsetEdge(segment, -sideSign / 2);
      const outer = offsetEdge(segment, sideSign / 2);
      if (source.laneIndex === 0) {
        markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_median`, rule: MARKING_RULES[1], points: inner, color: '#facc15', width: .7, priority: 25 });
      } else {
        markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_divider`, rule: MARKING_RULES[3], points: inner, color: '#f8fafc', width: .55, dash: '5 5', priority: 20 });
      }
      if (source.laneIndex === laneCount - 1) {
        markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_edge`, rule: MARKING_RULES[2], points: outer, color: '#f8fafc', width: .75, priority: 24 });
      }
      const points = segmentPoints(segment);
      const arrow = pointAtDistance(points, Math.min(28, Math.max(8, points.length * 1.5)));
      const travel = entry ? scale(arrow.tangent, -1) : arrow.tangent;
      markings.push({ kind: 'fill', id: `${segment.routeId}_${segment.segIndex}_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, travel), color: '#f8fafc', priority: 35 });
    } else if (segment.kind === 'entry-fillet' && segment.geom.kind === 'arc') {
      const arc = segment.geom as Arc;
      const setbackAngle = Math.min((segment.wEnd / 2 + 1.5) / Math.max(arc.r, 1), Math.abs(arc.a1 - arc.a0) * .45);
      const angle = arc.a1 - arc.dir * setbackAngle;
      markings.push(...yieldTeeth(arcPoint(arc, angle), arcTangent(arc, angle), segment.wStart, `${segment.routeId}_${segment.segIndex}`));
    } else if (segment.kind === 'bypass-curve') {
      markings.push({ kind: 'stroke', id: `${segment.routeId}_curve_left`, rule: MARKING_RULES[2], points: offsetEdge(segment, -.5), color: '#f8fafc', width: .7, priority: 24 });
      markings.push({ kind: 'stroke', id: `${segment.routeId}_curve_right`, rule: MARKING_RULES[2], points: offsetEdge(segment, .5), color: '#f8fafc', width: .7, priority: 24 });
      const points = segmentPoints(segment);
      const arrow = pointAtDistance(points, Math.max(6, points.reduce((sum, point, index) => index ? sum + len(sub(point, points[index - 1])) : sum, 0) / 2));
      markings.push({ kind: 'fill', id: `${segment.routeId}_curve_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, arrow.tangent, 6), color: '#f8fafc', priority: 35 });
    }
  }

  markings.push(...buildRingEnvelopeMarkings(segments));
  const ringSegments = segments.filter(segment => segment.kind === 'ring-arc' && segment.geom.kind === 'arc');
  for (const segment of ringSegments) {
    const arc = segment.geom as Arc;
    const angle = (arc.a0 + arc.a1) / 2;
    markings.push({ kind: 'fill', id: `${segment.routeId}_ring_arrow`, rule: MARKING_RULES[6], points: arrowShape(arcPoint(arc, angle), arcTangent(arc, angle), 6), color: '#f8fafc', priority: 35 });
  }

  for (const arm of config.arms) {
    const entry = segments.find(segment => segment.kind === 'entry-line' && segment.source.kind === 'lane' && segment.source.armId === arm.id && segment.source.dir === 'in' && segment.source.laneIndex === 0);
    const exit = segments.find(segment => segment.kind === 'exit-line' && segment.source.kind === 'lane' && segment.source.armId === arm.id && segment.source.dir === 'out' && segment.source.laneIndex === 0);
    if (!entry || !exit) continue;
    const entrySign = isRHD ? 1 : -1;
    const exitSign = -entrySign;
    const entryInner = offsetEdge(entry, -entrySign / 2);
    const exitInner = offsetEdge(exit, -exitSign / 2);
    const count = Math.min(entryInner.length, exitInner.length);
    if (count > 1) {
      markings.push({
        kind: 'fill',
        id: `${arm.id}_splitter`,
        rule: 'The space between opposing inner lane edges is rendered as a physical splitter median.',
        points: [...entryInner.slice(-count), ...exitInner.slice(-count).reverse()],
        color: '#cbd5e1',
        priority: 5
      });
    }
  }

  return markings.sort((a, b) => a.priority - b.priority);
}
