import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, type Polyline, arcPoint, arcTangent, linePoint } from '../geometry/primitives';
import { type Vec2, add, len, norm, perpLeft, scale, sub } from '../math/vector';

export const MARKING_RULES = [
  'Road pavement is rendered first so every marking remains visible at overlaps.',
  'The lane beside a median receives a solid yellow inner edge line.',
  'The outside edge of each approach and exit receives a solid white edge line.',
  'Boundaries between lanes receive broken white lane-separator lines.',
  'Circulatory lane boundaries are broken rather than continuous concentric circles.',
  'Every entering lane receives yield teeth at the line-to-fillet intersection; exits never receive yield markings.',
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
      if (segment.kind === 'entry-line') {
        const point = points[0];
        const outward = norm(sub(points[Math.min(1, points.length - 1)], point));
        markings.push(...yieldTeeth(add(point, scale(outward, 1.5)), scale(outward, -1), widthAt(segment, 0, points.length), `${segment.routeId}_${segment.segIndex}`));
      }
    } else if (segment.kind === 'bypass-curve') {
      markings.push({ kind: 'stroke', id: `${segment.routeId}_curve_left`, rule: MARKING_RULES[2], points: offsetEdge(segment, -.5), color: '#f8fafc', width: .7, priority: 24 });
      markings.push({ kind: 'stroke', id: `${segment.routeId}_curve_right`, rule: MARKING_RULES[2], points: offsetEdge(segment, .5), color: '#f8fafc', width: .7, priority: 24 });
      const points = segmentPoints(segment);
      const arrow = pointAtDistance(points, Math.max(6, points.reduce((sum, point, index) => index ? sum + len(sub(point, points[index - 1])) : sum, 0) / 2));
      markings.push({ kind: 'fill', id: `${segment.routeId}_curve_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, arrow.tangent, 6), color: '#f8fafc', priority: 35 });
    }
  }

  const ringSegments = segments.filter(segment => segment.kind === 'ring-arc' && segment.source.kind === 'ring');
  for (const segment of ringSegments) {
    if (segment.source.kind !== 'ring') continue;
    const source = segment.source;
    const index = config.rings.findIndex(ring => ring.id === source.ringId);
    const inner = offsetEdge(segment, -.5);
    const outer = offsetEdge(segment, .5);
    if (index === 0) markings.push({ kind: 'stroke', id: `${segment.routeId}_ring_inner`, rule: MARKING_RULES[1], points: inner, color: '#facc15', width: .7, priority: 25 });
    markings.push({
      kind: 'stroke',
      id: `${segment.routeId}_ring_outer`,
      rule: index === config.rings.length - 1 ? MARKING_RULES[2] : MARKING_RULES[4],
      points: outer,
      color: '#f8fafc',
      width: .65,
      dash: index === config.rings.length - 1 ? undefined : '4 4',
      priority: 22
    });
    const arc = segment.geom.kind === 'arc' ? segment.geom as Arc : null;
    if (arc) {
      const angle = (arc.a0 + arc.a1) / 2;
      markings.push({ kind: 'fill', id: `${segment.routeId}_ring_arrow`, rule: MARKING_RULES[6], points: arrowShape(arcPoint(arc, angle), arcTangent(arc, angle), 6), color: '#f8fafc', priority: 35 });
    }
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
