import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, type Polyline, arcContainsAngle, arcPoint, arcTangent, linePoint } from '../geometry/primitives';
import { type Vec2, add, angleOf, dot, len, norm, perpLeft, scale, sub } from '../math/vector';

export const MARKING_RULES = [
  'Road pavement is rendered first so every marking remains visible at overlaps.',
  'The lane beside a median receives a solid yellow inner edge line.',
  'The outside edge of each approach and exit receives a solid white edge line.',
  'Boundaries between lanes receive broken white lane-separator lines.',
  'Each ring stays independently outlined in white while each connected ring set receives one yellow central envelope.',
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

function pathLength(points: Vec2[]) {
  return points.reduce((total, point, index) => index === 0 ? 0 : total + len(sub(point, points[index - 1])), 0);
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

type PathSample = { point: Vec2; width: number };

function ringClearance(sample: PathSample, rings: RoundaboutConfig['rings']) {
  return rings.reduce((clearance, ring) => {
    const distance = len(sub(sample.point, ring.center));
    const halfWidth = sample.width / 2;
    const innerRadius = Math.max(0, ring.radius - ring.width / 2);
    const outerRadius = ring.radius + ring.width / 2;
    return Math.min(clearance, Math.max(distance - halfWidth - outerRadius, innerRadius - distance - halfWidth));
  }, Infinity);
}

function yieldPoint(config: RoundaboutConfig, line: ResolvedSegment | undefined, fillet: ResolvedSegment, setback: number) {
  const linePoints = line ? segmentPoints(line) : [];
  const lineSamples = linePoints.map((point, index) => ({ point, width: line ? widthAt(line, index, linePoints.length) : fillet.wStart })).reverse();
  const filletPoints = segmentPoints(fillet);
  const filletSamples = filletPoints.map((point, index) => ({ point, width: widthAt(fillet, index, filletPoints.length) }));
  if (lineSamples.length > 0 && filletSamples.length > 0 && len(sub(lineSamples.at(-1)!.point, filletSamples[0].point)) < 1e-5) filletSamples.shift();
  const samples = [...lineSamples, ...filletSamples];
  if (samples.length < 2 || ringClearance(samples[0], config.rings) <= 0) return null;
  let intersectionIndex = -1;
  for (let index = 1; index < samples.length; index++) {
    if (ringClearance(samples[index], config.rings) <= 0) {
      intersectionIndex = index;
      break;
    }
  }
  if (intersectionIndex < 1) return null;
  const before = samples[intersectionIndex - 1];
  const after = samples[intersectionIndex];
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 16; iteration++) {
    const t = (low + high) / 2;
    const sample = {
      point: add(before.point, scale(sub(after.point, before.point), t)),
      width: before.width + (after.width - before.width) * t
    };
    if (ringClearance(sample, config.rings) <= 0) high = t;
    else low = t;
  }
  const intersection = {
    point: add(before.point, scale(sub(after.point, before.point), high)),
    width: before.width + (after.width - before.width) * high
  };
  const approach = [...samples.slice(0, intersectionIndex), intersection];
  let remaining = setback;
  for (let index = approach.length - 1; index > 0; index--) {
    const edge = sub(approach[index].point, approach[index - 1].point);
    const edgeLength = len(edge);
    if (edgeLength >= remaining) {
      const t = edgeLength > 1e-9 ? remaining / edgeLength : 0;
      return {
        point: add(approach[index].point, scale(edge, -t)),
        travel: norm(edge),
        width: approach[index].width + (approach[index - 1].width - approach[index].width) * t
      };
    }
    remaining -= edgeLength;
  }
  return null;
}

function buildYieldMarkings(config: RoundaboutConfig, segments: ResolvedSegment[], setback: number) {
  const markings: FillMarking[] = [];
  for (const fillet of segments.filter(segment => segment.kind === 'entry-fillet' && segment.geom.kind === 'arc')) {
    const line = segments.find(segment => segment.routeId === fillet.routeId && segment.kind === 'entry-line' && segment.source.kind === 'lane'
      && fillet.source.kind === 'lane' && segment.source.armId === fillet.source.armId && segment.source.dir === fillet.source.dir && segment.source.laneIndex === fillet.source.laneIndex);
    const placement = yieldPoint(config, line, fillet, setback);
    if (placement) markings.push(...yieldTeeth(placement.point, placement.travel, placement.width, `${fillet.routeId}_${fillet.segIndex}`));
  }
  return markings;
}

function pointInsideSegment(point: Vec2, segment: ResolvedSegment, collisionBuffer: number) {
  const points = segmentPoints(segment);
  for (let index = 0; index < points.length - 1; index++) {
    const edge = sub(points[index + 1], points[index]);
    const edgeLengthSquared = dot(edge, edge);
    if (edgeLengthSquared < 1e-9) continue;
    const t = Math.max(0, Math.min(1, dot(sub(point, points[index]), edge) / edgeLengthSquared));
    const projected = add(points[index], scale(edge, t));
    const startWidth = widthAt(segment, index, points.length);
    const endWidth = widthAt(segment, index + 1, points.length);
    if (len(sub(point, projected)) <= Math.max(0, (startWidth + (endWidth - startWidth) * t) / 2 + collisionBuffer)) return true;
  }
  return false;
}

function pushPointRuns(markings: Marking[], values: ({ point: Vec2; status: 'solid' | 'dashed' | 'gap' } | null)[], baseId: string, rule: string, color: string, width: number, priority: number) {
  let run: Vec2[] = [];
  let status: 'solid' | 'dashed' | 'gap' = 'gap';
  const flush = () => {
    if (run.length > 1 && status !== 'gap') markings.push({ kind: 'stroke', id: `${baseId}_${markings.length}`, rule, points: run, color, width, dash: status === 'dashed' ? '5 5' : undefined, priority });
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

type ArcPavementSegment = ResolvedSegment & { geom: Arc };

type RingSegment = ArcPavementSegment & { source: { kind: 'ring'; ringId: string } };

type RadialInterval = { start: number; end: number };

function rayCircleRoots(origin: Vec2, direction: Vec2, center: Vec2, radius: number) {
  const relative = sub(origin, center);
  const b = 2 * dot(relative, direction);
  const c = dot(relative, relative) - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  return [(-b - root) / 2, (-b + root) / 2].filter(value => value >= 0);
}

function radialIntervals(origin: Vec2, direction: Vec2, segment: ArcPavementSegment): RadialInterval[] {
  const innerRadius = Math.max(.01, segment.geom.r - segment.wStart / 2);
  const outerRadius = segment.geom.r + segment.wStart / 2;
  const roots = [0, ...rayCircleRoots(origin, direction, segment.geom.c, innerRadius), ...rayCircleRoots(origin, direction, segment.geom.c, outerRadius)].sort((a, b) => a - b);
  roots.push((roots.at(-1) ?? 0) + outerRadius * .1 + 1);
  const intervals: RadialInterval[] = [];
  for (let index = 0; index < roots.length - 1; index++) {
    const start = roots[index];
    const end = roots[index + 1];
    const midpoint = add(origin, scale(direction, (start + end) / 2));
    const radial = sub(midpoint, segment.geom.c);
    const distance = len(radial);
    if (distance >= innerRadius - 1e-5 && distance <= outerRadius + 1e-5 && arcContainsAngle(segment.geom, angleOf(radial))) intervals.push({ start, end });
  }
  return intervals;
}

function ringComponents(segments: RingSegment[]) {
  const representatives = [...new Map(segments.map(segment => [segment.source.ringId, segment])).values()];
  const touches = (a: RingSegment, b: RingSegment) => {
    const distance = len(sub(a.geom.c, b.geom.c));
    const innerA = Math.max(0, a.geom.r - a.wStart / 2);
    const innerB = Math.max(0, b.geom.r - b.wStart / 2);
    const outerA = a.geom.r + a.wStart / 2;
    const outerB = b.geom.r + b.wStart / 2;
    return distance <= outerA + outerB && distance + Math.min(outerA, outerB) >= Math.max(innerA, innerB);
  };
  const remaining = new Set(representatives);
  const components: RingSegment[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as RingSegment;
    remaining.delete(first);
    const component = [first];
    for (let index = 0; index < component.length; index++) {
      for (const candidate of [...remaining]) {
        if (!touches(component[index], candidate)) continue;
        remaining.delete(candidate);
        component.push(candidate);
      }
    }
    const ids = new Set(component.map(segment => segment.source.ringId));
    components.push(segments.filter(segment => ids.has(segment.source.ringId)));
  }
  return components;
}

function buildRingEnvelopeMarkings(segments: ResolvedSegment[], collisionBuffer: number) {
  const markings: Marking[] = [];
  const ringSegments = segments.filter((segment): segment is RingSegment => segment.kind === 'ring-arc' && segment.source.kind === 'ring' && segment.geom.kind === 'arc');
  const roadSegments = segments.filter(segment => segment.source.kind === 'lane');
  for (const segment of ringSegments) {
    const centerline = segmentPoints(segment);
    const values = (factor: number) => centerline.map((point, index) => {
      const edgePoint = add(point, scale(norm(sub(point, segment.geom.c)), widthAt(segment, index, centerline.length) * factor));
      return {
        point: edgePoint,
        status: roadSegments.some(road => pointInsideSegment(edgePoint, road, collisionBuffer)) ? 'dashed' as const : 'solid' as const
      };
    });
    const id = `${segment.source.ringId}_${segment.routeId}_${segment.segIndex}`;
    pushPointRuns(markings, values(.5), `${id}_outer`, 'Each ring receives an independent white outer edge, dashed only where connector pavement intersects it.', '#f8fafc', .8, 28);
    pushPointRuns(markings, values(-.5), `${id}_inner`, 'Each non-central ring edge remains white.', '#f8fafc', .8, 28);
  }
  ringComponents(ringSegments).forEach((component, componentIndex) => {
    const representatives = [...new Map(component.map(segment => [segment.source.ringId, segment])).values()];
    const ringIds = new Set(representatives.map(segment => segment.source.ringId));
    const pavement = segments.filter((segment): segment is ArcPavementSegment => segment.geom.kind === 'arc'
      && (segment.kind === 'ring-arc' || segment.kind === 'entry-fillet' || segment.kind === 'exit-fillet')
      && ((segment.source.kind === 'ring' && ringIds.has(segment.source.ringId)) || Boolean(segment.ringId && ringIds.has(segment.ringId))));
    const center = scale(representatives.reduce((sum, segment) => add(sum, segment.geom.c), { x: 0, y: 0 }), 1 / representatives.length);
    const values = Array.from({ length: 361 }, (_, index) => {
      const angle = index / 360 * Math.PI * 2;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const intervals = pavement.flatMap(segment => radialIntervals(center, direction, segment)).filter(interval => interval.end > 1e-5);
      if (intervals.length === 0) return null;
      const nearest = intervals.reduce((best, interval) => interval.start < best.start ? interval : best);
      if (nearest.start <= 1e-5) return null;
      const point = add(center, scale(direction, nearest.start));
      return {
        point,
        status: roadSegments.some(road => pointInsideSegment(point, road, collisionBuffer)) ? 'dashed' as const : 'solid' as const
      };
    });
    pushPointRuns(markings, values, `central_component_${componentIndex}`, 'The contiguous inner envelope of each connected ring set receives the yellow central line.', '#facc15', .8, 29);
  });
  return markings;
}

export type MarkingOptions = {
  ringLaneCollisionBuffer?: number;
  yieldSetback?: number;
};

export function buildMarkings(config: RoundaboutConfig, segments: ResolvedSegment[], options: MarkingOptions = {}): Marking[] {
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
      const laneCount = source.dir === 'in' ? arm.lanesIn.length : arm.lanesOut.length;
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
      const availableLength = pathLength(points);
      if (availableLength >= 14) {
        const arrow = pointAtDistance(points, Math.min(28, availableLength / 2));
        const travel = entry ? scale(arrow.tangent, -1) : arrow.tangent;
        markings.push({ kind: 'fill', id: `${segment.routeId}_${segment.segIndex}_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, travel), color: '#f8fafc', priority: 35 });
      }
    } else if (segment.kind === 'bypass-entry-connector' || segment.kind === 'bypass-lane' || segment.kind === 'bypass-exit-connector') {
      markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_left`, rule: MARKING_RULES[2], points: offsetEdge(segment, -.5), color: '#f8fafc', width: .7, priority: 24 });
      markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_right`, rule: MARKING_RULES[2], points: offsetEdge(segment, .5), color: '#f8fafc', width: .7, priority: 24 });
      if (segment.kind === 'bypass-lane') {
        const points = segmentPoints(segment);
        const availableLength = pathLength(points);
        if (availableLength >= 12) {
          const arrow = pointAtDistance(points, availableLength / 2);
          markings.push({ kind: 'fill', id: `${segment.routeId}_lane_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, arrow.tangent, 6), color: '#f8fafc', priority: 35 });
        }
      }
    }
  }

  markings.push(...buildRingEnvelopeMarkings(segments, options.ringLaneCollisionBuffer ?? 0));
  const ringSegments = segments.filter(segment => segment.kind === 'ring-arc' && segment.geom.kind === 'arc');
  for (const segment of ringSegments) {
    const arc = segment.geom as Arc;
    if (Math.abs(arc.a1 - arc.a0) * arc.r < 12) continue;
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

  markings.push(...buildYieldMarkings(config, segments, options.yieldSetback ?? 6));

  return markings.sort((a, b) => a.priority - b.priority);
}
