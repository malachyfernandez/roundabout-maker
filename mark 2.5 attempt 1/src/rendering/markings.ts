import { type ArmConfig, type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { type Arc, type Line, type Polyline, arcContainsAngle, arcPoint, arcTangent, linePoint } from '../geometry/primitives';
import { type Vec2, add, angleOf, dot, len, norm, perpLeft, scale, sub } from '../math/vector';
import { interpolateProfile, isProfileLanePresent, laneBounds, profileSampleFrameAt, sampleProfile, type ProfileSection } from '../core/profile/model';
import { segmentEdgeRuns } from './segmentPath';

export const MARKING_RULES = [
  'Road pavement is rendered first so every marking remains visible at overlaps.',
  'The edge of the innermost live lane facing the median receives a solid yellow line.',
  'The outside edge of each approach and exit receives a solid white edge line.',
  'Boundaries between lanes receive broken white lane-separator lines.',
  'Each ring stays independently outlined in white while each connected ring set receives one yellow central envelope.',
  'Every entering lane receives yield teeth immediately before its connector reaches the first live ring; exits never receive yield markings.',
  'Entry arrows point toward the roundabout, exit arrows point away, and ring arrows follow circulation.',
  'Yield markings render above arrows, edges, and separators because they communicate priority.',
  'The space between the innermost live lane edges of opposing directions is filled as a physical median, outlined in yellow only where it borders a lane.'
] as const;

export type StrokeMarking = {
  kind: 'stroke';
  id: string;
  rule: string;
  points: Vec2[];
  color: string;
  width: number;
  dash?: string;
  dashOffset?: number;
  priority: number;
  armId?: string;
};

export type FillMarking = {
  kind: 'fill';
  id: string;
  rule: string;
  points: Vec2[];
  color: string;
  priority: number;
  armId?: string;
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

function offsetEdge(segment: ResolvedSegment, factor: number) {
  const runs = segmentEdgeRuns(segment, factor > 0 ? 'left' : 'right');
  return runs.length === 1 ? runs[0] : runs.flat();
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

function yieldTeeth(point: Vec2, travel: Vec2, laneWidth: number, id: string, armId?: string): FillMarking[] {
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
      priority: 50,
      armId
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
    if (placement) markings.push(...yieldTeeth(placement.point, placement.travel, placement.width, `${fillet.routeId}_${fillet.segIndex}`, fillet.source.kind === 'lane' ? fillet.source.armId : undefined));
  }
  return markings;
}

type PavementEdge = { ax: number; ay: number; dx: number; dy: number; lengthSquared: number; startRadius: number; endRadius: number; minX: number; minY: number; maxX: number; maxY: number };
type PavementFootprint = { edges: PavementEdge[]; minX: number; minY: number; maxX: number; maxY: number };

function pavementFootprint(segment: ResolvedSegment, collisionBuffer: number): PavementFootprint {
  const points = segmentPoints(segment);
  const edges: PavementEdge[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-9) continue;
    const startRadius = Math.max(0, widthAt(segment, index, points.length) / 2 + collisionBuffer);
    const endRadius = Math.max(0, widthAt(segment, index + 1, points.length) / 2 + collisionBuffer);
    const radius = Math.max(startRadius, endRadius);
    const edge = { ax: a.x, ay: a.y, dx, dy, lengthSquared, startRadius, endRadius, minX: Math.min(a.x, b.x) - radius, minY: Math.min(a.y, b.y) - radius, maxX: Math.max(a.x, b.x) + radius, maxY: Math.max(a.y, b.y) + radius };
    minX = Math.min(minX, edge.minX);
    minY = Math.min(minY, edge.minY);
    maxX = Math.max(maxX, edge.maxX);
    maxY = Math.max(maxY, edge.maxY);
    edges.push(edge);
  }
  return { edges, minX, minY, maxX, maxY };
}

function pointInsideFootprint(point: Vec2, footprint: PavementFootprint) {
  if (point.x < footprint.minX || point.x > footprint.maxX || point.y < footprint.minY || point.y > footprint.maxY) return false;
  for (const edge of footprint.edges) {
    if (point.x < edge.minX || point.x > edge.maxX || point.y < edge.minY || point.y > edge.maxY) continue;
    const t = Math.max(0, Math.min(1, ((point.x - edge.ax) * edge.dx + (point.y - edge.ay) * edge.dy) / edge.lengthSquared));
    const dx = point.x - (edge.ax + edge.dx * t);
    const dy = point.y - (edge.ay + edge.dy * t);
    const radius = edge.startRadius + (edge.endRadius - edge.startRadius) * t;
    if (dx * dx + dy * dy <= radius * radius) return true;
  }
  return false;
}

type StrokeStatus = 'solid' | 'short-dashed' | 'gap';

type MarkingDimensions = {
  lineWidth: number;
  shortDashLength: number;
  shortDashGap: number;
  longDashLength: number;
  longDashGap: number;
  dividerSolidLength: number;
  dividerDottedLength: number;
};

const US_MARKING_DIMENSIONS: MarkingDimensions = {
  lineWidth: .5,
  shortDashLength: 2,
  shortDashGap: 4,
  longDashLength: 10,
  longDashGap: 30,
  dividerSolidLength: 20,
  dividerDottedLength: 24
};

function dashPattern(length: number, gap: number) {
  return `${length} ${gap}`;
}

function pointBetween(a: Vec2, b: Vec2, t: number) {
  return add(a, scale(sub(b, a), t));
}

function statusTransition(a: Vec2, b: Vec2, startStatus: StrokeStatus, classify: (point: Vec2) => StrokeStatus) {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const middle = (low + high) / 2;
    if (classify(pointBetween(a, b, middle)) === startStatus) low = middle;
    else high = middle;
  }
  return pointBetween(a, b, (low + high) / 2);
}

function classifiedEdge(a: Vec2, b: Vec2, classify: (point: Vec2) => StrokeStatus) {
  const startStatus = classify(a);
  const endStatus = classify(b);
  if (startStatus !== endStatus) {
    const transition = statusTransition(a, b, startStatus, classify);
    return [{ a, b: transition, status: startStatus }, { a: transition, b, status: endStatus }];
  }
  const middle = pointBetween(a, b, .5);
  const middleStatus = classify(middle);
  if (middleStatus === startStatus) return [{ a, b, status: startStatus }];
  const first = statusTransition(a, middle, startStatus, classify);
  const second = statusTransition(middle, b, middleStatus, classify);
  return [{ a, b: first, status: startStatus }, { a: first, b: second, status: middleStatus }, { a: second, b, status: endStatus }];
}

function pushClassifiedRuns(markings: Marking[], points: Vec2[], classify: (point: Vec2) => StrokeStatus, baseId: string, rule: string, color: string, width: number, priority: number, shortDash: string, armId?: string) {
  let run: Vec2[] = [];
  let status: StrokeStatus = 'gap';
  let runIndex = 0;
  const flush = () => {
    if (run.length > 1 && status !== 'gap') markings.push({ kind: 'stroke', id: `${baseId}_${status}_${runIndex++}`, rule, points: run, color, width, dash: status === 'short-dashed' ? shortDash : undefined, priority, armId });
    run = [];
  };
  for (let index = 1; index < points.length; index++) {
    for (const part of classifiedEdge(points[index - 1], points[index], classify)) {
      if (part.status !== status) {
        flush();
        status = part.status;
      }
      if (run.length === 0) run.push(part.a);
      run.push(part.b);
    }
  }
  flush();
}

function pushPointRuns(markings: Marking[], values: ({ point: Vec2; status: 'solid' | 'gap' } | null)[], baseId: string, rule: string, color: string, width: number, priority: number) {
  let run: Vec2[] = [];
  let status: 'solid' | 'gap' = 'gap';
  const flush = () => {
    if (run.length > 1 && status === 'solid') markings.push({ kind: 'stroke', id: `${baseId}_${markings.length}`, rule, points: run, color, width, priority });
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

function pathRange(points: Vec2[], start: number, end: number) {
  const total = pathLength(points);
  const from = Math.max(0, Math.min(total, start));
  const to = Math.max(from, Math.min(total, end));
  if (to - from < 1e-6) return [];
  const result = [pointAtDistance(points, from).point];
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += len(sub(points[index], points[index - 1]));
    if (distance > from + 1e-6 && distance < to - 1e-6) result.push(points[index]);
  }
  result.push(pointAtDistance(points, to).point);
  return result;
}

type ArmAxis = ReturnType<typeof sampleProfile>;

const armAxisCache = new WeakMap<ArmConfig, ArmAxis | null>();

// The road axis every lane hangs off of. Needed to tell which side of a lane
// edge faces the median — legs attached at the road's far end arrive with
// swapped boundary arrays, so left/right names alone are unreliable — and to
// build the median envelope between the two directions' innermost lanes.
function armAxis(arm: ArmConfig): ArmAxis | null {
  const cached = armAxisCache.get(arm);
  if (cached !== undefined) return cached;
  const axis = arm.nodes.length >= 2
    ? sampleProfile(arm, { points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: .5, tension: 0 }, 90)
    : null;
  armAxisCache.set(arm, axis);
  return axis;
}

// Signed lateral offset of a point from the road axis: positive on the
// left/normal side of the outward direction.
function axisOffset(axis: ArmAxis, point: Vec2) {
  let best = Infinity;
  let offset = 0;
  for (let index = 0; index + 1 < axis.samples.length; index++) {
    const a = axis.samples[index].p;
    const edge = sub(axis.samples[index + 1].p, a);
    const lengthSquared = dot(edge, edge);
    if (lengthSquared < 1e-9) continue;
    const t = Math.max(0, Math.min(1, dot(sub(point, a), edge) / lengthSquared));
    const delta = sub(point, add(a, scale(edge, t)));
    const distanceSquared = dot(delta, delta);
    if (distanceSquared < best) {
      best = distanceSquared;
      offset = dot(delta, norm(perpLeft(edge)));
    }
  }
  return Number.isFinite(best) ? offset : null;
}

function edgeAxisOffset(axis: ArmAxis, runs: Vec2[][]) {
  const points = runs.flat();
  let total = 0;
  let count = 0;
  for (const probe of [points[0], points[points.length >> 1], points[points.length - 1]]) {
    if (!probe) continue;
    const offset = axisOffset(axis, probe);
    if (offset === null) continue;
    total += offset;
    count++;
  }
  return count > 0 ? total / count : null;
}

// Splits an edge polyline into runs by whether each part touches neighboring
// pavement. `distance` is the run's start offset along the edge so distance-
// anchored patterns (the divider phases) stay aligned to the whole edge.
function contactRuns(points: Vec2[], touches: (point: Vec2) => boolean) {
  const runs: { contact: boolean; distance: number; points: Vec2[] }[] = [];
  let walked = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    for (const part of classifiedEdge(a, b, point => touches(point) ? 'solid' : 'gap')) {
      const contact = part.status === 'solid';
      const distance = walked + len(sub(part.a, a));
      const last = runs[runs.length - 1];
      if (last && last.contact === contact) last.points.push(part.b);
      else runs.push({ contact, distance, points: [part.a, part.b] });
    }
    walked += len(sub(b, a));
  }
  return runs;
}

function pushDividerMarkings(markings: Marking[], run: { distance: number; points: Vec2[] }, baseId: string, dimensions: MarkingDimensions, shortDash: string, longDash: string, armId?: string) {
  const start = run.distance;
  const end = start + pathLength(run.points);
  const emit = (phaseStart: number, phaseEnd: number, suffix: string, dash?: string) => {
    const points = pathRange(run.points, Math.max(0, phaseStart - start), Math.max(0, Math.min(phaseEnd, end) - start));
    if (points.length > 1) markings.push({ kind: 'stroke', id: `${baseId}_${suffix}`, rule: MARKING_RULES[3], points, color: '#f8fafc', width: dimensions.lineWidth, dash, dashOffset: dash === longDash ? dimensions.longDashLength : undefined, priority: 20, armId });
  };
  emit(0, dimensions.dividerSolidLength, 'divider_solid');
  emit(dimensions.dividerSolidLength, dimensions.dividerSolidLength + dimensions.dividerDottedLength, 'divider_short', shortDash);
  emit(dimensions.dividerSolidLength + dimensions.dividerDottedLength, Infinity, 'divider_long', longDash);
}

// The median fills the space between the innermost live lane on each side of
// the road axis. Where a side has no live lane the boundary falls back to the
// nominal median edge, so the strip always covers exactly the space between
// the two roadways.
function buildMedianMarkings(config: RoundaboutConfig) {
  const markings: Marking[] = [];
  const inSign = config.circulation === 'ccw' ? 1 : -1;
  for (const arm of config.arms) {
    const axis = armAxis(arm);
    if (!axis) continue;
    const innerEdgeOffset = (section: ProfileSection, dir: 'in' | 'out') => {
      const lanes = dir === 'in' ? section.lanesIn : section.lanesOut;
      for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
        if (isProfileLanePresent(lanes[laneIndex])) return laneBounds(section, dir, laneIndex).inner;
      }
      return section.medianWidth / 2;
    };
    const boundaryPoint = (dir: 'in' | 'out', distance: number) => {
      const frame = profileSampleFrameAt(axis.samples, axis.distances, distance);
      const offset = innerEdgeOffset(interpolateProfile(axis.profile, distance), dir);
      return add(frame.p, scale(frame.normal, (dir === 'in' ? inSign : -inSign) * offset));
    };
    const stations = axis.sections.map((section, index) => {
      const sample = axis.samples[index];
      return {
        distance: axis.distances[index],
        inside: add(sample.p, scale(sample.normal, inSign * innerEdgeOffset(section, 'in'))),
        outside: add(sample.p, scale(sample.normal, -inSign * innerEdgeOffset(section, 'out'))),
        present: section.lanesIn.some(isProfileLanePresent) || section.lanesOut.some(isProfileLanePresent)
      };
    });
    const startCap = axis.profile.find(point => point.endAnchor === 'start')?.distance ?? 0;
    const endCap = axis.profile.find(point => point.endAnchor === 'end')?.distance ?? axis.totalLength;
    const insideRing = (point: Vec2) => config.rings.some(ring => {
      const distance = len(sub(point, ring.center));
      return distance > Math.max(0, ring.radius - ring.width / 2) - .3 && distance < ring.radius + ring.width / 2 + .3;
    });
    const firstCapIndex = stations.findIndex(station => station.distance >= startCap - .01);
    let lastCapIndex = -1;
    for (let index = stations.length - 1; index >= 0; index--) {
      if (stations[index].distance <= endCap + .01) {
        lastCapIndex = index;
        break;
      }
    }
    let runStart = -1;
    let runIndex = 0;
    const flush = (last: number) => {
      if (runStart < 0) return;
      const first = runStart;
      runStart = -1;
      if (last <= first) return;
      const inPoints = stations.slice(first, last + 1).map(station => station.inside);
      const outPoints = stations.slice(first, last + 1).map(station => station.outside);
      // Runs bounded by the road's own cap-ends get spliced to the exact cap
      // distance; runs ending because of a ring or a lane gap just stop.
      if (first === firstCapIndex && stations[first].distance > startCap + .01) {
        inPoints.unshift(boundaryPoint('in', startCap));
        outPoints.unshift(boundaryPoint('out', startCap));
      }
      if (last === lastCapIndex && stations[last].distance < endCap - .01) {
        inPoints.push(boundaryPoint('in', endCap));
        outPoints.push(boundaryPoint('out', endCap));
      }
      const points = [...inPoints, ...outPoints.reverse()];
      if (points.length > 2) {
        markings.push({ kind: 'fill', id: `${arm.id}_median_${runIndex++}`, rule: MARKING_RULES[8], points, color: '#cbd5e1', priority: 5, armId: arm.id });
      }
    };
    for (let index = 0; index < stations.length; index++) {
      const station = stations[index];
      const included = station.distance >= startCap - .01 && station.distance <= endCap + .01
        && station.present && !insideRing(station.inside) && !insideRing(station.outside);
      if (included) {
        if (runStart < 0) runStart = index;
      } else if (runStart >= 0) {
        flush(index - 1);
      }
    }
    flush(stations.length - 1);
  }
  return markings;
}

type ArcPavementSegment = ResolvedSegment & { geom: Arc };

type RingSegment = ArcPavementSegment & { source: { kind: 'ring'; ringId: string } };

type RadialInterval = { start: number; end: number };

function cross(a: Vec2, b: Vec2) {
  return a.x * b.y - a.y * b.x;
}

function arcProgress(arc: Arc, angle: number) {
  let delta = angle - arc.a0;
  if (arc.dir === 1) while (delta < 0) delta += Math.PI * 2;
  else while (delta > 0) delta -= Math.PI * 2;
  return delta / (arc.a1 - arc.a0);
}

function pointInsideArcPavement(point: Vec2, segment: ArcPavementSegment) {
  const radial = sub(point, segment.geom.c);
  const angle = angleOf(radial);
  if (!arcContainsAngle(segment.geom, angle)) return false;
  const progress = Math.max(0, Math.min(1, arcProgress(segment.geom, angle)));
  const width = segment.wStart + (segment.wEnd - segment.wStart) * progress;
  const distance = len(radial);
  return distance >= Math.max(.01, segment.geom.r - width / 2) - 1e-5 && distance <= segment.geom.r + width / 2 + 1e-5;
}

const arcPavementBoundaryCache = new WeakMap<ArcPavementSegment, Vec2[]>();

function arcPavementBoundary(segment: ArcPavementSegment) {
  const cached = arcPavementBoundaryCache.get(segment);
  if (cached) return cached;
  const arc = segment.geom;
  const count = Math.max(12, Math.ceil(Math.abs(arc.a1 - arc.a0) / (Math.PI / 180)));
  const edge = (factor: number) => Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count;
    const width = segment.wStart + (segment.wEnd - segment.wStart) * progress;
    return arcPoint({ ...arc, r: Math.max(.01, arc.r + width * factor) }, arc.a0 + (arc.a1 - arc.a0) * progress);
  });
  const boundary = [...edge(.5), ...edge(-.5).reverse()];
  arcPavementBoundaryCache.set(segment, boundary);
  return boundary;
}

function radialIntervals(origin: Vec2, direction: Vec2, segment: ArcPavementSegment): RadialInterval[] {
  const boundary = arcPavementBoundary(segment);
  const roots = [0];
  for (let index = 0; index < boundary.length; index++) {
    const start = boundary[index];
    const edge = sub(boundary[(index + 1) % boundary.length], start);
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-9) continue;
    const relative = sub(start, origin);
    const rayDistance = cross(relative, edge) / denominator;
    const edgeProgress = cross(relative, direction) / denominator;
    if (rayDistance >= 0 && edgeProgress >= -1e-7 && edgeProgress <= 1 + 1e-7) roots.push(rayDistance);
  }
  roots.sort((a, b) => a - b);
  const uniqueRoots = roots.filter((root, index) => index === 0 || Math.abs(root - roots[index - 1]) > 1e-5);
  uniqueRoots.push((uniqueRoots.at(-1) ?? 0) + segment.geom.r + Math.max(segment.wStart, segment.wEnd) + 1);
  const intervals: RadialInterval[] = [];
  for (let index = 0; index < uniqueRoots.length - 1; index++) {
    const start = uniqueRoots[index];
    const end = uniqueRoots[index + 1];
    if (pointInsideArcPavement(add(origin, scale(direction, (start + end) / 2)), segment)) intervals.push({ start, end });
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

function ringPavementContains(point: Vec2, segment: RingSegment, buffer = 0) {
  const radial = sub(point, segment.geom.c);
  const distance = len(radial);
  const innerRadius = Math.max(0, segment.geom.r - segment.wStart / 2 - buffer);
  const outerRadius = segment.geom.r + segment.wStart / 2 + buffer;
  return distance >= innerRadius - 1e-7 && distance <= outerRadius + 1e-7 && arcContainsAngle(segment.geom, angleOf(radial));
}

function ringEdgePoints(segment: RingSegment, factor: number) {
  const arc = segment.geom;
  const count = Math.max(12, Math.ceil(Math.abs(arc.a1 - arc.a0) / (Math.PI / 180)));
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const angle = arc.a0 + (arc.a1 - arc.a0) * t;
    const width = segment.wStart + (segment.wEnd - segment.wStart) * t;
    return arcPoint({ ...arc, r: arc.r + width * factor }, angle);
  });
}

function buildRingEnvelopeMarkings(segments: ResolvedSegment[], collisionBuffer: number, dimensions: MarkingDimensions) {
  const markings: Marking[] = [];
  const ringSegments = segments.filter((segment): segment is RingSegment => segment.kind === 'ring-arc' && segment.source.kind === 'ring' && segment.geom.kind === 'arc');
  const roadFootprints = segments.filter(segment => segment.source.kind === 'lane').map(segment => pavementFootprint(segment, collisionBuffer));
  const shortDash = dashPattern(dimensions.shortDashLength, dimensions.shortDashGap);
  for (const segment of ringSegments) {
    const overlapsAnotherRing = (point: Vec2) => ringSegments.some(other => other.source.ringId !== segment.source.ringId && ringPavementContains(point, other));
    const id = `${segment.source.ringId}_${segment.routeId}_${segment.segIndex}`;
    pushClassifiedRuns(markings, ringEdgePoints(segment, .5), point => overlapsAnotherRing(point) ? 'gap' : roadFootprints.some(footprint => pointInsideFootprint(point, footprint)) ? 'short-dashed' : 'solid', `${id}_outer`, 'Connected ring pavement has one white outer boundary, with short dashed openings only at connector pavement.', '#f8fafc', dimensions.lineWidth, 28, shortDash);
    pushClassifiedRuns(markings, ringEdgePoints(segment, -.5), point => overlapsAnotherRing(point) ? 'gap' : roadFootprints.some(footprint => pointInsideFootprint(point, footprint)) ? 'short-dashed' : 'solid', `${id}_inner`, 'Inner ring edges use short dashed openings where connector pavement crosses them and disappear inside overlapping rings.', '#f8fafc', dimensions.lineWidth, 28, shortDash);
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
      return { point: add(center, scale(direction, nearest.start)), status: 'solid' as const };
    });
    pushPointRuns(markings, values, `central_component_${componentIndex}`, 'The contiguous inner envelope of each connected ring set receives an uninterrupted solid yellow line.', '#facc15', dimensions.lineWidth, 29);
  });
  return markings;
}

export type MarkingOptions = {
  ringLaneCollisionBuffer?: number;
  yieldSetback?: number;
  lineWidth?: number;
  shortDashLength?: number;
  shortDashGap?: number;
  longDashLength?: number;
  longDashGap?: number;
  dividerSolidLength?: number;
  dividerDottedLength?: number;
};

export function buildMarkings(config: RoundaboutConfig, segments: ResolvedSegment[], options: MarkingOptions = {}): Marking[] {
  const markings: Marking[] = [];
  const isRHD = config.circulation === 'ccw';
  const roadSegments = segments.filter(segment => segment.source.kind === 'lane');
  const ringSegments = segments.filter((segment): segment is RingSegment => segment.kind === 'ring-arc' && segment.source.kind === 'ring' && segment.geom.kind === 'arc');
  const dimensions: MarkingDimensions = {
    lineWidth: options.lineWidth ?? US_MARKING_DIMENSIONS.lineWidth,
    shortDashLength: options.shortDashLength ?? US_MARKING_DIMENSIONS.shortDashLength,
    shortDashGap: options.shortDashGap ?? US_MARKING_DIMENSIONS.shortDashGap,
    longDashLength: options.longDashLength ?? US_MARKING_DIMENSIONS.longDashLength,
    longDashGap: options.longDashGap ?? US_MARKING_DIMENSIONS.longDashGap,
    dividerSolidLength: options.dividerSolidLength ?? US_MARKING_DIMENSIONS.dividerSolidLength,
    dividerDottedLength: options.dividerDottedLength ?? US_MARKING_DIMENSIONS.dividerDottedLength
  };
  const shortDash = dashPattern(dimensions.shortDashLength, dimensions.shortDashGap);
  const longDash = dashPattern(dimensions.longDashLength, dimensions.longDashGap);

  // Pavement footprints per (arm, direction, laneIndex) drive edge
  // classification: a lane edge bordering a neighboring lane's pavement is a
  // lane boundary (separator / shared edge); bordering open space toward the
  // median or the roadside makes it the road's actual edge line.
  const sideFootprints = new Map<string, { laneIndex: number; footprint: PavementFootprint }[]>();
  for (const segment of roadSegments) {
    if (segment.source.kind !== 'lane') continue;
    const key = `${segment.source.armId}|${segment.source.dir}`;
    const list = sideFootprints.get(key) ?? [];
    list.push({ laneIndex: segment.source.laneIndex, footprint: pavementFootprint(segment, .2) });
    sideFootprints.set(key, list);
  }

  for (const segment of roadSegments) {
    if (segment.source.kind !== 'lane') continue;
    const source = segment.source;
    const arm = config.arms.find(candidate => candidate.id === source.armId);
    if (!arm) continue;
    if (segment.kind === 'entry-fillet' || segment.kind === 'exit-fillet') {
      const classify = (point: Vec2): StrokeStatus => ringSegments.some(ring => ringPavementContains(point, ring)) ? 'gap' : 'solid';
      pushClassifiedRuns(markings, offsetEdge(segment, -.5), classify, `${segment.routeId}_${segment.segIndex}_curve_left`, 'Entry and exit curves receive a white line on both sides, hidden only within ring pavement.', '#f8fafc', dimensions.lineWidth, 24, shortDash, source.armId);
      pushClassifiedRuns(markings, offsetEdge(segment, .5), classify, `${segment.routeId}_${segment.segIndex}_curve_right`, 'Entry and exit curves receive a white line on both sides, hidden only within ring pavement.', '#f8fafc', dimensions.lineWidth, 24, shortDash, source.armId);
      continue;
    }
    const roadKind = segment.kind === 'entry-line' || segment.kind === 'bypass-entry'
      ? 'entry'
      : segment.kind === 'exit-line' || segment.kind === 'bypass-exit'
        ? 'exit'
        : null;
    if (roadKind) {
      const entry = roadKind === 'entry';
      const dirSign = isRHD === (source.dir === 'in') ? 1 : -1;
      const leftRuns = segmentEdgeRuns(segment, 'left');
      const rightRuns = segmentEdgeRuns(segment, 'right');
      const axis = armAxis(arm);
      const leftOffset = axis ? edgeAxisOffset(axis, leftRuns) : null;
      const rightOffset = axis ? edgeAxisOffset(axis, rightRuns) : null;
      let innerRuns: Vec2[][];
      let outerRuns: Vec2[][];
      if (leftOffset !== null && rightOffset !== null && leftOffset !== rightOffset) {
        const innerIsLeft = dirSign * leftOffset < dirSign * rightOffset;
        innerRuns = innerIsLeft ? leftRuns : rightRuns;
        outerRuns = innerIsLeft ? rightRuns : leftRuns;
      } else {
        const sideSign = (isRHD ? (entry ? 1 : -1) : (entry ? -1 : 1)) * (segment.endpoint === 'end' ? -1 : 1);
        innerRuns = sideSign > 0 ? rightRuns : leftRuns;
        outerRuns = sideSign > 0 ? leftRuns : rightRuns;
      }
      const innerFootprints: PavementFootprint[] = [];
      const outerFootprints: PavementFootprint[] = [];
      for (const sibling of sideFootprints.get(`${source.armId}|${source.dir}`) ?? []) {
        if (sibling.laneIndex < source.laneIndex) innerFootprints.push(sibling.footprint);
        if (sibling.laneIndex > source.laneIndex) outerFootprints.push(sibling.footprint);
      }
      innerRuns.forEach((run, runIndex) => {
        contactRuns(run, point => innerFootprints.some(footprint => pointInsideFootprint(point, footprint))).forEach((part, partIndex) => {
          const baseId = `${segment.routeId}_${segment.segIndex}_${runIndex}_${partIndex}`;
          if (part.contact) pushDividerMarkings(markings, part, baseId, dimensions, shortDash, longDash, source.armId);
          else if (part.points.length > 1) markings.push({ kind: 'stroke', id: `${baseId}_median`, rule: MARKING_RULES[1], points: part.points, color: '#facc15', width: dimensions.lineWidth, priority: 25, armId: source.armId });
        });
      });
      outerRuns.forEach((run, runIndex) => {
        contactRuns(run, point => outerFootprints.some(footprint => pointInsideFootprint(point, footprint))).forEach((part, partIndex) => {
          if (!part.contact && part.points.length > 1) markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_${runIndex}_${partIndex}_edge`, rule: MARKING_RULES[2], points: part.points, color: '#f8fafc', width: dimensions.lineWidth, priority: 24, armId: source.armId });
        });
      });
      const points = segmentPoints(segment);
      const availableLength = pathLength(points);
      if (availableLength >= 14) {
        const arrow = pointAtDistance(points, Math.min(28, availableLength / 2));
        const travel = entry ? scale(arrow.tangent, -1) : arrow.tangent;
        markings.push({ kind: 'fill', id: `${segment.routeId}_${segment.segIndex}_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, travel), color: '#f8fafc', priority: 35, armId: source.armId });
      }
    } else if (segment.kind === 'bypass-entry-connector' || segment.kind === 'bypass-lane' || segment.kind === 'bypass-exit-connector') {
      markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_left`, rule: MARKING_RULES[2], points: offsetEdge(segment, -.5), color: '#f8fafc', width: dimensions.lineWidth, priority: 24, armId: source.armId });
      markings.push({ kind: 'stroke', id: `${segment.routeId}_${segment.segIndex}_right`, rule: MARKING_RULES[2], points: offsetEdge(segment, .5), color: '#f8fafc', width: dimensions.lineWidth, priority: 24, armId: source.armId });
      if (segment.kind === 'bypass-lane') {
        const points = segmentPoints(segment);
        const availableLength = pathLength(points);
        if (availableLength >= 12) {
          const arrow = pointAtDistance(points, availableLength / 2);
          markings.push({ kind: 'fill', id: `${segment.routeId}_lane_arrow`, rule: MARKING_RULES[6], points: arrowShape(arrow.point, arrow.tangent, 6), color: '#f8fafc', priority: 35, armId: source.armId });
        }
      }
    }
  }

  markings.push(...buildRingEnvelopeMarkings(segments, options.ringLaneCollisionBuffer ?? 0, dimensions));
  for (const segment of ringSegments) {
    const arc = segment.geom as Arc;
    if (Math.abs(arc.a1 - arc.a0) * arc.r < 12) continue;
    const angle = (arc.a0 + arc.a1) / 2;
    markings.push({ kind: 'fill', id: `${segment.routeId}_ring_arrow`, rule: MARKING_RULES[6], points: arrowShape(arcPoint(arc, angle), arcTangent(arc, angle), 6), color: '#f8fafc', priority: 35 });
  }

  markings.push(...buildMedianMarkings(config));

  markings.push(...buildYieldMarkings(config, segments, options.yieldSetback ?? 6));

  return markings.sort((a, b) => a.priority - b.priority);
}
