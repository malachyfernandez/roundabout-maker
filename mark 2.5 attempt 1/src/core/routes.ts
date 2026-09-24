import { type ArmConfig, type RingConfig, type RoundaboutConfig } from './config';
import { solveFillet, solveLineLineFillets, type FilletSolution, type LineLineFilletSolution } from '../geometry/fillet';
import { type Line, normalizeAngle } from '../geometry/primitives';
import { add, fromAngle, scale, sub, normalize, dot, len, angleOf, type Vec2 } from '../math/vector';
import { BYPASS_CONNECTOR_MAX_SCORE, createRightTurnBypass, resolveBypassLanePoint } from './bypass';
import { offsetSplineSamples, sampleSpline } from '../math/spline';
import { miterOffsetEdges } from '../math/polyline';
import { laneOffsetAt, profileSampleFrameAt, ringOuterEdgePathIndex, sampleProfile } from './profile';

export type RoadEndpoint = 'start' | 'end';

// A point on the road's guide spline plus the direction pointing off the end
// of the road. Lane strips clip their edges to the line through `p` that is
// perpendicular to `outward`, so every lane ends on the same crosscut.
export type CapLine = { p: Vec2; outward: Vec2 };

export type LaneBoundaries = { left: Vec2[]; right: Vec2[] };

export type EntryLeg = {
  armId: string;
  laneIdx: number;
  dir: 'in' | 'out';
  endpoint: RoadEndpoint;
  line: Line;
  points: {x:number, y:number}[];
  widths: number[];
  boundaries: LaneBoundaries;
  fillet: FilletSolution;
  endCap?: CapLine;
};

export type ExitLeg = {
  armId: string;
  laneIdx: number;
  dir: 'in' | 'out';
  endpoint: RoadEndpoint;
  line: Line;
  points: {x:number, y:number}[];
  widths: number[];
  boundaries: LaneBoundaries;
  fillet: FilletSolution;
  endCap?: CapLine;
};

export type ThroughRoute = {
  kind: 'through';
  id: string;
  ringId: string;
  entry: EntryLeg;
  ringSpan: { a0: number; a1: number; dir: 1 | -1 };
  exit: ExitLeg;
};

export type StandaloneEntry = {
  kind: 'standalone-entry';
  id: string;
  ringId: string;
  entry: EntryLeg;
};

export type StandaloneExit = {
  kind: 'standalone-exit';
  id: string;
  ringId: string;
  exit: ExitLeg;
};

export type FullRingRoute = {
  kind: 'full-ring';
  id: string;
  ringId: string;
  center: { x: number; y: number };
  radius: number;
};

export type ProfileLaneRoute = {
  kind: 'profile-lane';
  id: string;
  armId: string;
  laneIdx: number;
  dir: 'in' | 'out';
  points: { x: number; y: number }[];
  widths: number[];
  boundaries: LaneBoundaries;
  startCap?: CapLine;
  endCap?: CapLine;
};

export type BypassRoute = {
  kind: 'bypass';
  id: string;
  bypassId: string;
  entryRadius: number;
  exitRadius: number;
  entry: { armId: string; laneIdx: number; points: Vec2[]; widths: number[]; boundaries: LaneBoundaries; endCap?: CapLine };
  entryConnector: LineLineFilletSolution;
  lane: { line: Line; width: number };
  exitConnector: LineLineFilletSolution;
  exit: { armId: string; laneIdx: number; points: Vec2[]; widths: number[]; boundaries: LaneBoundaries; endCap?: CapLine };
};

export type RouteSymbolic = ThroughRoute | StandaloneEntry | StandaloneExit | FullRingRoute | BypassRoute | ProfileLaneRoute;

// Map circulation string to geometric dir (1 = increasing angle, -1 = decreasing)
export function getCircDir(circ: 'ccw' | 'cw'): 1 | -1 {
  return circ === 'ccw' ? -1 : 1;
}

// Signed angular distance from `from` to `to` walking in `dir`. Result in [0, 2π).
function angularDistance(from: number, to: number, dir: 1 | -1): number {
  let diff = normalizeAngle(to - from);
  if (dir === 1 && diff < 0) diff += 2 * Math.PI;
  if (dir === -1 && diff > 0) diff -= 2 * Math.PI;
  return Math.abs(diff);
}

function solveFilletAlongPath(
  points: { x: number; y: number }[],
  ringCenter: { x: number; y: number },
  ringRadius: number,
  filletRadius: number,
  turnDir: 1 | -1,
  isEntry: boolean,
  circDir: 1 | -1
): { line: Line; fillet: FilletSolution } | null {
  // Try the requested fillet radius first, then progressively reduce it.
  // This handles cases where the requested radius is too large for the
  // approach angle (e.g. filletRadius > ringRadius at certain angles).
  const minFilletRadius = Math.min(filletRadius, Math.max(2, ringRadius * 0.1));
  const solveAtRadius = (tryRadius: number) => {
    let best: { line: Line; fillet: FilletSolution; distance: number } | null = null;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const outward = normalize(sub(b, a));
      if (len(outward) < 1e-9) continue;
      const line: Line = {
        kind: 'line',
        p: isEntry ? b : a,
        u: isEntry ? { x: -outward.x, y: -outward.y } : outward,
        t0: -1000,
        t1: 1000
      };
      const fillet = solveFillet(line, ringCenter, ringRadius, tryRadius, turnDir, isEntry, circDir);
      if (!fillet) continue;
      const edge = sub(b, a);
      const edgeLengthSquared = dot(edge, edge);
      const t = dot(sub(fillet.tangentPointLine, a), edge) / edgeLengthSquared;
      if (t < -1e-6 || t > 1 + 1e-6) continue;
      let remainingLength = len(sub(b, fillet.tangentPointLine));
      for (let next = i + 1; next < points.length - 1; next++) remainingLength += len(sub(points[next + 1], points[next]));
      if (remainingLength < .5) continue;
      const projected = { x: a.x + edge.x * t, y: a.y + edge.y * t };
      const distance = len(sub(fillet.tangentPointLine, projected));
      if (!best || distance < best.distance) best = { line, fillet, distance };
    }
    return best;
  };

  const requested = solveAtRadius(filletRadius);
  if (requested) return { line: requested.line, fillet: requested.fillet };

  const searchSteps = 24;
  let failedRadius = filletRadius;
  for (let step = 1; step <= searchSteps; step++) {
    const radius = filletRadius - (filletRadius - minFilletRadius) * step / searchSteps;
    const solved = solveAtRadius(radius);
    if (!solved) {
      failedRadius = radius;
      continue;
    }
    let lowerRadius = radius;
    let lowerSolution = solved;
    let upperRadius = failedRadius;
    for (let iteration = 0; iteration < 12; iteration++) {
      const candidateRadius = (lowerRadius + upperRadius) / 2;
      const candidate = solveAtRadius(candidateRadius);
      if (candidate) {
        lowerRadius = candidateRadius;
        lowerSolution = candidate;
      } else {
        upperRadius = candidateRadius;
      }
    }
    return { line: lowerSolution.line, fillet: lowerSolution.fillet };
  }
  return null;
}

// Where the lane would meet the ring if it never diverged (fillet radius 0):
// the first crossing of the lane path with the ring centerline circle,
// starting from the lane endpoint that attaches to this ring.
function laneRingCrossingAngle(points: Vec2[], ring: RingConfig): number | null {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const d = sub(points[i + 1], a);
    const A = dot(d, d);
    if (A < 1e-12) continue;
    const f = sub(a, ring.center);
    const B = 2 * dot(f, d);
    const C = dot(f, f) - ring.radius * ring.radius;
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sqrtD = Math.sqrt(disc);
    const t1 = (-B - sqrtD) / (2 * A);
    const t2 = (-B + sqrtD) / (2 * A);
    const t = t1 >= -1e-9 && t1 <= 1 + 1e-9 ? t1 : t2 >= -1e-9 && t2 <= 1 + 1e-9 ? t2 : null;
    if (t === null) continue;
    const p = add(a, scale(d, Math.max(0, Math.min(1, t))));
    return angleOf(sub(p, ring.center));
  }
  return null;
}

// Index of the sample nearest the path's arc-length midpoint. Each end of a
// lane can connect to a different ring, and each endpoint's solver only sees
// the half of the path nearest it. The spline sampler allocates samples per
// node-span, so an index midpoint tracks node placement — a node sitting
// inside the ring would swallow that endpoint's entire half, leaving the
// fillet solver no points outside the ring to attach to. Splitting by arc
// length keeps the divider fixed wherever mid-road nodes sit.
function pathMidpointIndex(points: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(sub(points[i], points[i - 1]));
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    walked += len(sub(points[i], points[i - 1]));
    if (walked >= total / 2) return i;
  }
  return Math.max(0, points.length - 1);
}

function endpointPath<T>(values: T[], endpoint: RoadEndpoint, midpoint: number): T[] {
  return endpoint === 'start' ? values.slice(0, midpoint + 1) : values.slice(midpoint).reverse();
}

function endpointBoundaries(boundaries: LaneBoundaries, endpoint: RoadEndpoint, midpoint: number): LaneBoundaries {
  if (endpoint === 'start') {
    return {
      left: boundaries.left.slice(0, midpoint + 1),
      right: boundaries.right.slice(0, midpoint + 1)
    };
  }
  return {
    left: [...boundaries.right.slice(midpoint)].reverse(),
    right: [...boundaries.left.slice(midpoint)].reverse()
  };
}

function reversedBoundaries(boundaries: LaneBoundaries): LaneBoundaries {
  return { left: [...boundaries.right].reverse(), right: [...boundaries.left].reverse() };
}

function lanePath(config: RoundaboutConfig, arm: ArmConfig, dir: 'in' | 'out', laneIndex: number) {
  const baseSpline = {
    points: arm.nodes.map(node => node.point),
    nodes: arm.nodes,
    alpha: 0.5,
    tension: 0
  };
  const profile = sampleProfile(arm, baseSpline, 90);
  const laneIsIn = dir === 'in';
  const isRHD = config.circulation === 'ccw';
  const offsets = profile.sections.map(section => laneOffsetAt(section, laneIndex, laneIsIn, isRHD));
  return {
    points: offsetSplineSamples(profile.samples, offsets),
    widths: profile.sections.map(section => laneIsIn ? section.lanesIn[laneIndex]?.width ?? 0 : section.lanesOut[laneIndex]?.width ?? 0)
  };
}

export function laneRoleAtEndpoint(dir: 'in' | 'out', endpoint: RoadEndpoint): 'entry' | 'exit' {
  return (dir === 'in') === (endpoint === 'start') ? 'entry' : 'exit';
}

export function laneRingIdAtEndpoint(arm: ArmConfig, dir: 'in' | 'out', laneIndex: number, endpoint: RoadEndpoint): string | undefined {
  const lane = dir === 'in' ? arm.lanesIn[laneIndex] : arm.lanesOut[laneIndex];
  return laneRoleAtEndpoint(dir, endpoint) === 'entry' ? lane?.targetsRing : lane?.sourceRing;
}

export function laneFilletRadiusAtEndpoint(arm: ArmConfig, dir: 'in' | 'out', laneIndex: number, endpoint: RoadEndpoint): number {
  const lane = dir === 'in' ? arm.lanesIn[laneIndex] : arm.lanesOut[laneIndex];
  return laneRoleAtEndpoint(dir, endpoint) === 'entry'
    ? lane?.targetFilletRadius ?? lane?.filletRadius ?? 15
    : lane?.sourceFilletRadius ?? lane?.filletRadius ?? 15;
}

export function laneIntersectsRingAtEndpoint(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, endpoint: RoadEndpoint): boolean {
  const arm = config.arms.find(candidate => candidate.id === armId);
  const ring = config.rings.find(candidate => candidate.id === ringId);
  if (!arm || !ring || arm.nodes.length < 2) return false;
  const path = lanePath(config, arm, dir, laneIndex);
  const midpoint = pathMidpointIndex(path.points);
  const points = endpointPath(path.points, endpoint, midpoint);
  const widths = endpointPath(path.widths, endpoint, midpoint);
  const outerRadius = ring.radius + ring.width / 2;
  return points.some((point, index) => len(sub(point, ring.center)) <= outerRadius + (widths[index] ?? 0) / 2);
}

export function solveLaneFillet(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, endpoint: RoadEndpoint = 'start'): FilletSolution | null {
  const arm = config.arms.find(candidate => candidate.id === armId);
  const ring = config.rings.find(candidate => candidate.id === ringId);
  const lane = dir === 'in' ? arm?.lanesIn[laneIndex] : arm?.lanesOut[laneIndex];
  if (!arm || !ring || !lane || arm.nodes.length < 2 || !laneIntersectsRingAtEndpoint(config, armId, dir, laneIndex, ringId, endpoint)) return null;

  const lanePoints = lanePath(config, arm, dir, laneIndex).points;
  const points = endpointPath(lanePoints, endpoint, pathMidpointIndex(lanePoints));
  const isEntry = laneRoleAtEndpoint(dir, endpoint) === 'entry';
  const isRHD = config.circulation === 'ccw';
  const filletRadius = laneFilletRadiusAtEndpoint(arm, dir, laneIndex, endpoint);
  const turnDir = isRHD ? -1 : 1;
  return solveFilletAlongPath(points, ring.center, ring.radius, filletRadius, turnDir, isEntry, getCircDir(config.circulation))?.fillet ?? null;
}

export function solveLaneRingAttachmentPoint(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, endpoint: RoadEndpoint = 'start'): Vec2 | null {
  return solveLaneFillet(config, armId, dir, laneIndex, ringId, endpoint)?.tangentPointRing ?? null;
}

type BypassConnectorCandidate = {
  solution: LineLineFilletSolution;
  laneSegmentIndex: number;
  bypassT: number;
  score: number;
};

function segmentDistanceSquared(point: Vec2, a: Vec2, b: Vec2) {
  const edge = sub(b, a);
  const edgeLengthSquared = dot(edge, edge);
  if (edgeLengthSquared < 1e-9) return dot(sub(point, a), sub(point, a));
  const t = Math.max(0, Math.min(1, dot(sub(point, a), edge) / edgeLengthSquared));
  const projected = add(a, scale(edge, t));
  return dot(sub(point, projected), sub(point, projected));
}

function widthAtSegment(widths: number[], index: number, point: Vec2, a: Vec2, b: Vec2) {
  const edge = sub(b, a);
  const edgeLengthSquared = dot(edge, edge);
  const t = edgeLengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), edge) / edgeLengthSquared));
  return (widths[index] ?? 10) * (1 - t) + (widths[index + 1] ?? widths[index] ?? 10) * t;
}

function solveBypassConnectorCandidates(points: Vec2[], bypassLine: Line, radius: number, isEntry: boolean): BypassConnectorCandidate[] {
  const candidates: BypassConnectorCandidate[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const outward = normalize(sub(b, a));
    if (len(outward) < 1e-9) continue;
    const laneLine: Line = { kind: 'line', p: a, u: isEntry ? scale(outward, -1) : outward, t0: -1000, t1: 1000 };
    const solutions = isEntry
      ? solveLineLineFillets(laneLine, bypassLine, radius)
      : solveLineLineFillets(bypassLine, laneLine, radius);
    for (const solution of solutions) {
      const lanePoint = isEntry ? solution.tangentPointFrom : solution.tangentPointTo;
      candidates.push({
        solution,
        laneSegmentIndex: index,
        bypassT: isEntry ? solution.tTo : solution.tFrom,
        score: segmentDistanceSquared(lanePoint, a, b)
      });
    }
  }
  return candidates;
}

export type CompileOptions = {
  profileEnabled?: boolean;
  bypassEnabled?: boolean;
  sampleCount?: number;
};

function solveBestBypassPair(
  fromPoints: Vec2[], toPoints: Vec2[], bypassLine: Line, entryRadius: number, exitRadius: number
): { entry: BypassConnectorCandidate; exit: BypassConnectorCandidate; score: number; entryRadius: number; exitRadius: number } | null {
  const minRadius = 5;
  for (let scale = 1; scale > 0.05; scale *= 0.75) {
    const tryEntryRadius = Math.max(minRadius, entryRadius * scale);
    const tryExitRadius = Math.max(minRadius, exitRadius * scale);
    const entryCandidates = solveBypassConnectorCandidates(fromPoints, bypassLine, tryEntryRadius, true);
    const exitCandidates = solveBypassConnectorCandidates(toPoints, bypassLine, tryExitRadius, false);
    let best: { entry: BypassConnectorCandidate; exit: BypassConnectorCandidate; score: number; entryRadius: number; exitRadius: number } | null = null;
    for (const entryCandidate of entryCandidates) {
      for (const exitCandidate of exitCandidates) {
        if (entryCandidate.bypassT >= exitCandidate.bypassT) continue;
        const score = entryCandidate.score + exitCandidate.score;
        if (!best || score < best.score) best = { entry: entryCandidate, exit: exitCandidate, score, entryRadius: tryEntryRadius, exitRadius: tryExitRadius };
      }
    }
    if (best) return best;
  }
  return null;
}

export function resolveLaneRing(config: RoundaboutConfig, arm: ArmConfig, dir: 'in' | 'out', laneIndex: number, endpoint: RoadEndpoint = 'start'): RingConfig | undefined {
  const endpointNode = endpoint === 'start' ? arm.nodes[0] : arm.nodes.at(-1);
  if (!endpointNode) return undefined;
  const assignedId = laneRingIdAtEndpoint(arm, dir, laneIndex, endpoint);
  const intersectingRings = config.rings.filter(ring => laneIntersectsRingAtEndpoint(config, arm.id, dir, laneIndex, ring.id, endpoint));
  const assigned = intersectingRings.find(ring => ring.id === assignedId);
  if (assigned) return assigned;
  return intersectingRings.reduce<RingConfig | undefined>((closest, ring) => {
    if (!closest) return ring;
    const distance = Math.abs(len(sub(endpointNode.point, ring.center)) - ring.radius);
    const closestDistance = Math.abs(len(sub(endpointNode.point, closest.center)) - closest.radius);
    return distance < closestDistance ? ring : closest;
  }, undefined);
}

export function compileRoutes(config: RoundaboutConfig, options: CompileOptions = {}): RouteSymbolic[] {
  const circDir = getCircDir(config.circulation);
  const isRHD = config.circulation === 'ccw';
  const sampleCount = options.sampleCount ?? 90;

  // 1. Precompute lane centerlines for all arms
  const lanePaths = new Map<string, { points: {x:number, y:number}[], widths: number[], boundaries: LaneBoundaries, line: Line, startCap?: CapLine, endCap?: CapLine }>();

  for (const arm of config.arms) {
    if (arm.nodes.length < 2) continue;

    const baseSpline = {
      points: arm.nodes.map(n => n.point),
      nodes: arm.nodes,
      alpha: 0.5, // Centripetal
      tension: 0.0
    };
    const profileSample = options.profileEnabled ? sampleProfile(arm, baseSpline, sampleCount) : null;
    const baseSamples = profileSample?.samples ?? sampleSpline(baseSpline, sampleCount);
    // The road's cap-ends sit on the base spline at the anchor distances; lane
    // strips clip to these shared lines so a curved road still ends straight.
    const startCapDistance = profileSample?.profile.find(point => point.endAnchor === 'start')?.distance ?? 0;
    const endCapDistance = profileSample?.profile.find(point => point.endAnchor === 'end')?.distance ?? profileSample?.totalLength ?? 0;
    const capFrames = profileSample ? {
      start: profileSampleFrameAt(profileSample.samples, profileSample.distances, startCapDistance),
      end: profileSampleFrameAt(profileSample.samples, profileSample.distances, endCapDistance)
    } : null;
    const startCap: CapLine | undefined = capFrames ? { p: capFrames.start.p, outward: scale(capFrames.start.tangent, -1) } : undefined;
    const endCap: CapLine | undefined = capFrames ? { p: capFrames.end.p, outward: capFrames.end.tangent } : undefined;

    // Helper to calculate cumulative widths at each node for offsetting
    const getOffsets = (getLaneWidths: (n: any) => number[], getMedian: (n: any) => number, laneIdx: number, isRHD: boolean, isEntry: boolean) => {
      return arm.nodes.map(node => {
        const laneWidths = getLaneWidths(node);
        const median = getMedian(node);
        let offset = median / 2;
        for (let i = 0; i <= laneIdx; i++) {
          if (i === laneIdx) {
            offset += (laneWidths[i] || 10) / 2;
          } else {
            offset += (laneWidths[i] || 10);
          }
        }
        // Base spline goes from center OUTWARDS. Tangent points outward.
        // perpLeft of outward = visual left when facing outward.
        // Positive offset = left of outward direction.
        //
        // RHD: you drive on the right side of the road.
        //   Entry (coming IN): right side when facing inward = LEFT side when facing outward = +offset
        //   Exit (going OUT):  right side when facing outward = -offset
        // LHD: mirror.
        //   Entry: -offset
        //   Exit:  +offset
        if (isRHD) {
          return isEntry ? offset : -offset;
        } else {
          return isEntry ? -offset : offset;
        }
      });
    };

    // Lane strip edges offset perpendicular to the lane's own centerline,
    // not the road's normal. Road-normal offsets shear the strip wherever
    // the lane's lateral offset changes along the road (a lane node dragged
    // sideways), shrinking its real width to width·cos(θ). The miter join
    // keeps the inside corner true at the bend instead of biting inward.
    const laneBoundaries = (center: Vec2[], widths: number[]): LaneBoundaries =>
      miterOffsetEdges(center, widths.map(width => (width ?? 0) / 2), index => baseSamples[index]?.normal ?? { x: 1, y: 0 });

    for (let i = 0; i < arm.lanesIn.length; i++) {
      const offsets = profileSample
        ? profileSample.sections.map(section => laneOffsetAt(section, i, true, isRHD))
        : getOffsets(n => n.laneWidthsIn || [], n => n.medianWidth, i, isRHD, true);
      const lanePoints = offsetSplineSamples(baseSamples, offsets); // returns array of Vec2
      const widths = profileSample
        ? profileSample.sections.map(section => section.lanesIn[i]?.width ?? 0)
        : lanePoints.map(() => arm.nodes[0].laneWidthsIn[i] || 10);
      const boundaries = laneBoundaries(lanePoints, widths);

      // Lane points go from center to out. The entry vector goes from out to center.
      // So tangent at [0] goes from center to out. We negate it for uIn.
      const pNear = lanePoints[0];
      const pNext = lanePoints[1];
      const uIn = normalize(sub(pNear, pNext)); // Points towards the roundabout center

      // The line used for fillet calculation starts far away and points towards pNear
      const pFar = lanePoints[lanePoints.length - 1];

      lanePaths.set(`${arm.id}_in_${i}`, {
        points: lanePoints,
        widths,
        boundaries,
        line: { kind: 'line', p: pFar, u: uIn, t0: 0, t1: 1000 },
        startCap,
        endCap
      });
    }

    for (let i = 0; i < arm.lanesOut.length; i++) {
      const offsets = profileSample
        ? profileSample.sections.map(section => laneOffsetAt(section, i, false, isRHD))
        : getOffsets(n => n.laneWidthsOut || [], n => n.medianWidth, i, isRHD, false);
      const lanePoints = offsetSplineSamples(baseSamples, offsets);
      const widths = profileSample
        ? profileSample.sections.map(section => section.lanesOut[i]?.width ?? 0)
        : lanePoints.map(() => arm.nodes[0].laneWidthsOut[i] || 10);
      const boundaries = laneBoundaries(lanePoints, widths);

      // Exit vector goes from center to out.
      const pNear = lanePoints[0];
      const pNext = lanePoints[1];
      const uOut = normalize(sub(pNext, pNear)); // Points away from the roundabout center

      lanePaths.set(`${arm.id}_out_${i}`, {
        points: lanePoints,
        widths,
        boundaries,
        line: { kind: 'line', p: pNear, u: uOut, t0: 0, t1: 1000 },
        startCap,
        endCap
      });
    }
  }

  const isPathVisible = (path: { widths: number[] }) => path.widths.some(width => width > .05);
  const bypassRoutes: BypassRoute[] = [];
  if (options.bypassEnabled) {
    for (const bypass of config.bypasses ?? []) {
      const from = lanePaths.get(`${bypass.fromArmId}_in_${bypass.fromLaneIndex}`);
      const to = lanePaths.get(`${bypass.toArmId}_out_${bypass.toLaneIndex}`);
      if (!from || !to || from.points.length < 2 || to.points.length < 2) continue;
      const entryTarget = { kind: 'lane' as const, armId: bypass.fromArmId, dir: 'in' as const, laneIndex: bypass.fromLaneIndex };
      const exitTarget = { kind: 'lane' as const, armId: bypass.toArmId, dir: 'out' as const, laneIndex: bypass.toLaneIndex };
      const generated = createRightTurnBypass(config, entryTarget, exitTarget, bypass.radius ?? 32, bypass.id);
      if (!generated) continue;
      const entryRadius = bypass.entryRadius ?? bypass.radius ?? generated.entryRadius;
      const exitRadius = bypass.exitRadius ?? bypass.radius ?? generated.exitRadius;
      const lanePoint = bypass.lanePoint ?? generated.lanePoint;
      const laneAngle = bypass.laneAngle ?? generated.laneAngle;
      const laneDirection = fromAngle(laneAngle);
      // Live Floor: the stored lanePoint is the user's requested value. The
      // resolved point lifts it along its ring radial whenever surrounding
      // pavement crowds it out OR the connectors can't attach there (a solve
      // whose tangent points fall off the lane paths renders "connected to
      // nothing"). It releases back to the requested value when the
      // obstruction moves away. See docs/LIVE-FLOOR.md.
      const viable = (point: Vec2) => {
        const candidateLine: Line = { kind: 'line', p: point, u: laneDirection, t0: -1000, t1: 1000 };
        const attempt = solveBestBypassPair(from.points, to.points, candidateLine, entryRadius, exitRadius);
        return attempt !== null && attempt.score <= BYPASS_CONNECTOR_MAX_SCORE;
      };
      const resolvedLanePoint = resolveBypassLanePoint(config, lanePoint, { lanePaths: lanePaths.values(), viable });
      const bypassLine: Line = { kind: 'line', p: resolvedLanePoint, u: laneDirection, t0: -1000, t1: 1000 };
      const resolved = solveBestBypassPair(from.points, to.points, bypassLine, entryRadius, exitRadius);
      if (!resolved) continue;
      const entryLanePoint = resolved.entry.solution.tangentPointFrom;
      const exitLanePoint = resolved.exit.solution.tangentPointTo;
      const fromWidth = widthAtSegment(from.widths, resolved.entry.laneSegmentIndex, entryLanePoint, from.points[resolved.entry.laneSegmentIndex], from.points[resolved.entry.laneSegmentIndex + 1]);
      const toWidth = widthAtSegment(to.widths, resolved.exit.laneSegmentIndex, exitLanePoint, to.points[resolved.exit.laneSegmentIndex], to.points[resolved.exit.laneSegmentIndex + 1]);
      bypassRoutes.push({
        kind: 'bypass',
        id: `bypass_${bypass.id}`,
        bypassId: bypass.id,
        entryRadius: resolved.entryRadius,
        exitRadius: resolved.exitRadius,
        entry: { armId: bypass.fromArmId, laneIdx: bypass.fromLaneIndex, points: from.points, widths: from.widths, boundaries: from.boundaries, endCap: from.endCap },
        entryConnector: resolved.entry.solution,
        lane: {
          line: { ...bypassLine, t0: resolved.entry.bypassT, t1: resolved.exit.bypassT },
          width: (fromWidth + toWidth) / 2
        },
        exitConnector: resolved.exit.solution,
        exit: { armId: bypass.toArmId, laneIdx: bypass.toLaneIndex, points: to.points, widths: to.widths, boundaries: to.boundaries, endCap: to.endCap }
      });
    }
  }
  const bypassEntries = new Set((options.bypassEnabled ? config.bypasses ?? [] : []).map(bypass => `${bypass.fromArmId}_${bypass.fromLaneIndex}`));
  const bypassExits = new Set((options.bypassEnabled ? config.bypasses ?? [] : []).map(bypass => `${bypass.toArmId}_${bypass.toLaneIndex}`));
  const profileLaneRoutes: ProfileLaneRoute[] = [];

  // 2. Solve fillets for all entry and exit lanes
  type CutPoint = {
    type: 'entry' | 'exit';
    armId: string;
    laneIdx: number;
    dir: 'in' | 'out';
    endpoint: RoadEndpoint;
    angle: number; // fillet tangent angle on the ring (post-divergence)
    sortAngle: number; // undiverged crossing angle (fillet radius 0)
    fillet: FilletSolution;
    line: Line;
    dropsRing: boolean; // only meaningful for exits
  };

  const ringCuts = new Map<string, CutPoint[]>();
  for (const ring of config.rings) ringCuts.set(ring.id, []);

  const getRing = (id: string) => config.rings.find((r) => r.id === id)!;
  const turnDir = isRHD ? -1 : 1;

  // Track which lanes successfully connected to a ring via fillet.
  // Lanes that don't connect will be rendered as standalone roads.
  const connectedLanes = new Set<string>();
  const connectedEndpoints = new Set<string>();
  for (const bypass of options.bypassEnabled ? config.bypasses ?? [] : []) {
    connectedEndpoints.add(`${bypass.fromArmId}_in_${bypass.fromLaneIndex}_start`);
    connectedEndpoints.add(`${bypass.toArmId}_out_${bypass.toLaneIndex}_start`);
  }

  for (const arm of config.arms) {
    for (const dir of ['in', 'out'] as const) {
      const lanes = dir === 'in' ? arm.lanesIn : arm.lanesOut;
      for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
        const key = `${arm.id}_${dir}_${laneIdx}`;
        const path = lanePaths.get(key);
        if (!path || !isPathVisible(path)) continue;
        for (const endpoint of ['start', 'end'] as const) {
          if (endpoint === 'start' && (dir === 'in' ? bypassEntries : bypassExits).has(`${arm.id}_${laneIdx}`)) continue;
          const ring = resolveLaneRing(config, arm, dir, laneIdx, endpoint);
          if (!ring) continue;
          const midpoint = pathMidpointIndex(path.points);
          const orientedPoints = endpointPath(path.points, endpoint, midpoint);
          const orientedWidths = endpointPath(path.widths, endpoint, midpoint);
          const ringIndex = ringOuterEdgePathIndex(orientedPoints, ring);
          if ((orientedWidths[ringIndex] ?? 0) < .5) continue;
          const role = laneRoleAtEndpoint(dir, endpoint);
          const solved = solveFilletAlongPath(orientedPoints, ring.center, ring.radius, laneFilletRadiusAtEndpoint(arm, dir, laneIdx, endpoint), turnDir, role === 'entry', circDir);
          if (!solved) continue;
          connectedLanes.add(key);
          connectedEndpoints.add(`${key}_${endpoint}`);
          ringCuts.get(ring.id)!.push({
            type: role,
            armId: arm.id,
            laneIdx,
            dir,
            endpoint,
            angle: solved.fillet.cutAngleRing,
            sortAngle: laneRingCrossingAngle(orientedPoints, ring) ?? solved.fillet.cutAngleRing,
            fillet: solved.fillet,
            line: solved.line,
            dropsRing: role === 'exit' ? lanes[laneIdx].dropsRing ?? false : false,
          });
        }
      }
    }
  }

  for (const route of bypassRoutes) {
    if (connectedEndpoints.has(`${route.entry.armId}_in_${route.entry.laneIdx}_end`)) {
      const midpoint = pathMidpointIndex(route.entry.points);
      route.entry.points = endpointPath(route.entry.points, 'start', midpoint);
      route.entry.widths = endpointPath(route.entry.widths, 'start', midpoint);
      route.entry.boundaries = endpointBoundaries(route.entry.boundaries, 'start', midpoint);
      delete route.entry.endCap;
    }
    if (connectedEndpoints.has(`${route.exit.armId}_out_${route.exit.laneIdx}_end`)) {
      const midpoint = pathMidpointIndex(route.exit.points);
      route.exit.points = endpointPath(route.exit.points, 'start', midpoint);
      route.exit.widths = endpointPath(route.exit.widths, 'start', midpoint);
      route.exit.boundaries = endpointBoundaries(route.exit.boundaries, 'start', midpoint);
      delete route.exit.endCap;
    }
  }

  // Build standalone road routes for lanes that didn't connect to any ring.
  // These are roads that don't intersect the roundabout — render them as plain roads.
  const standaloneRoadRoutes: ProfileLaneRoute[] = [];
  for (const arm of config.arms) {
    for (let i = 0; i < arm.lanesIn.length; i++) {
      const key = `${arm.id}_in_${i}`;
      if (connectedLanes.has(key) || bypassEntries.has(`${arm.id}_${i}`)) continue;
      const path = lanePaths.get(key);
      if (!path || !isPathVisible(path)) continue;
      standaloneRoadRoutes.push({
        kind: 'profile-lane',
        id: `standalone_${key}`,
        armId: arm.id,
        laneIdx: i,
        dir: 'in',
        points: path.points,
        widths: path.widths,
        boundaries: path.boundaries,
        startCap: path.startCap,
        endCap: path.endCap,
      });
    }
    for (let i = 0; i < arm.lanesOut.length; i++) {
      const key = `${arm.id}_out_${i}`;
      if (connectedLanes.has(key) || bypassExits.has(`${arm.id}_${i}`)) continue;
      const path = lanePaths.get(key);
      if (!path || !isPathVisible(path)) continue;
      standaloneRoadRoutes.push({
        kind: 'profile-lane',
        id: `standalone_${key}`,
        armId: arm.id,
        laneIdx: i,
        dir: 'out',
        points: path.points,
        widths: path.widths,
        boundaries: path.boundaries,
        startCap: path.startCap,
        endCap: path.endCap,
      });
    }
  }

  const legForCut = (cut: CutPoint): EntryLeg | ExitLeg => {
    const key = `${cut.armId}_${cut.dir}_${cut.laneIdx}`;
    const path = lanePaths.get(key)!;
    const opposite = cut.endpoint === 'start' ? 'end' : 'start';
    const split = connectedEndpoints.has(`${key}_${opposite}`);
    const midpoint = pathMidpointIndex(path.points);
    const points = split ? endpointPath(path.points, cut.endpoint, midpoint) : cut.endpoint === 'start' ? path.points : [...path.points].reverse();
    const widths = split ? endpointPath(path.widths, cut.endpoint, midpoint) : cut.endpoint === 'start' ? path.widths : [...path.widths].reverse();
    const boundaries = split
      ? endpointBoundaries(path.boundaries, cut.endpoint, midpoint)
      : cut.endpoint === 'start' ? path.boundaries : reversedBoundaries(path.boundaries);
    // A leg split at the midpoint ends mid-road; only an unsplit leg reaches
    // the road's far cap (the 'start' cap when the polyline is reversed).
    const endCap = split ? undefined : cut.endpoint === 'start' ? path.endCap : path.startCap;
    return { armId: cut.armId, laneIdx: cut.laneIdx, dir: cut.dir, endpoint: cut.endpoint, line: cut.line, fillet: cut.fillet, points, widths, boundaries, endCap };
  };

  // 3. Compile routes per ring using dropsRing logic
  const routes: RouteSymbolic[] = [...bypassRoutes, ...profileLaneRoutes, ...standaloneRoadRoutes];

  for (const [ringId, cuts] of ringCuts.entries()) {
    const entries = cuts.filter((c) => c.type === 'entry');
    const exits = cuts.filter((c) => c.type === 'exit');
    const droppedExits = exits.filter((e) => e.dropsRing);

    if (droppedExits.length === 0) {
      // Full circle ring!
      const ring = getRing(ringId);
      routes.push({
        kind: 'full-ring',
        id: `ring_${ringId}_full`,
        ringId,
        center: ring.center,
        radius: ring.radius,
      });
      for (const entry of entries) {
        routes.push({
          kind: 'standalone-entry',
          id: `entry_${entry.armId}-${entry.dir}-${entry.laneIdx}-${entry.endpoint}_${ringId}`,
          ringId,
          entry: legForCut(entry) as EntryLeg,
        });
      }
      for (const exit of exits) {
        routes.push({
          kind: 'standalone-exit',
          id: `exit_${exit.armId}-${exit.dir}-${exit.laneIdx}-${exit.endpoint}_${ringId}`,
          ringId,
          exit: legForCut(exit) as ExitLeg,
        });
      }
      continue;
    }

    // Determine the start for our perimeter walk. Use any dropped exit.
    const startDrop = droppedExits[0];

    // Sort cuts downstream from startDrop using the undiverged crossing
    // angles — users reason about where the lane meets the ring, not where
    // the fillet arc happens to land after curving onto it.
    const sortedCuts = cuts.map(c => {
      let d = angularDistance(startDrop.sortAngle, c.sortAngle, circDir);
      if (d < 1e-5) {
        if (c === startDrop) d = 2 * Math.PI;
        else if (c.type === 'exit' && c.dropsRing) d = 2 * Math.PI;
        else d = 0; // Entries at the exact same angle start the lap
      }
      return { cut: c, dist: d };
    }).sort((a, b) => {
      if (Math.abs(a.dist - b.dist) > 1e-5) return a.dist - b.dist;
      if (a.cut.type === 'entry' && b.cut.type === 'exit') return -1;
      if (a.cut.type === 'exit' && b.cut.type === 'entry') return 1;
      return 0;
    }).map(x => x.cut);

    let currentThroughEntry: CutPoint | null = null;

    for (const cut of sortedCuts) {
      if (cut.type === 'entry') {
        if (!currentThroughEntry) {
          currentThroughEntry = cut;
        } else {
          routes.push({
            kind: 'standalone-entry',
            id: `entry_${cut.armId}-${cut.dir}-${cut.laneIdx}-${cut.endpoint}_${ringId}`,
            ringId,
            entry: legForCut(cut) as EntryLeg,
          });
        }
      } else if (cut.type === 'exit') {
        if (cut.dropsRing) {
          if (currentThroughEntry) {
            // The undiverged ordering paired this entry with the drop, but the
            // fillet tangent points can land out of order on the ring (the lane
            // effectively "starts" on the ring after the exit left it). In that
            // case draw the short bridge arc between the two tangent points
            // rather than wrapping almost the full circle.
            const forward = angularDistance(currentThroughEntry.angle, cut.angle, circDir);
            const intended = angularDistance(currentThroughEntry.sortAngle, cut.sortAngle, circDir);
            const bridged = Math.abs(2 * Math.PI - forward - intended) < Math.abs(forward - intended);
            routes.push({
              kind: 'through',
              id: `route_${currentThroughEntry.armId}-${currentThroughEntry.dir}-${currentThroughEntry.laneIdx}-${currentThroughEntry.endpoint}_to_${cut.armId}-${cut.dir}-${cut.laneIdx}-${cut.endpoint}`,
              ringId,
              entry: legForCut(currentThroughEntry) as EntryLeg,
              ringSpan: bridged
                ? { a0: cut.angle, a1: currentThroughEntry.angle, dir: circDir }
                : { a0: currentThroughEntry.angle, a1: cut.angle, dir: circDir },
              exit: legForCut(cut) as ExitLeg,
            });
            currentThroughEntry = null;
          } else {
            routes.push({
              kind: 'standalone-exit',
              id: `exit_${cut.armId}-${cut.dir}-${cut.laneIdx}-${cut.endpoint}_${ringId}`,
              ringId,
              exit: legForCut(cut) as ExitLeg,
            });
          }
        } else {
          routes.push({
            kind: 'standalone-exit',
            id: `exit_${cut.armId}-${cut.dir}-${cut.laneIdx}-${cut.endpoint}_${ringId}`,
            ringId,
            exit: legForCut(cut) as ExitLeg,
          });
        }
      }
    }
  }

  return routes;
}

export function solveBypassAttachmentPoints(
  config: RoundaboutConfig,
  fromArmId: string,
  fromLaneIndex: number,
  toArmId: string,
  toLaneIndex: number,
  radius = 32
): { entry: Vec2; exit: Vec2 } | null {
  const previewId = '__attachment_preview__';
  const preview = structuredClone(config);
  const entryTarget = { kind: 'lane' as const, armId: fromArmId, dir: 'in' as const, laneIndex: fromLaneIndex };
  const exitTarget = { kind: 'lane' as const, armId: toArmId, dir: 'out' as const, laneIndex: toLaneIndex };
  const bypass = createRightTurnBypass(preview, entryTarget, exitTarget, radius, previewId);
  if (!bypass) return null;
  preview.bypasses = [bypass];
  const route = compileRoutes(preview, { profileEnabled: true, bypassEnabled: true })
    .find((candidate): candidate is BypassRoute => candidate.kind === 'bypass' && candidate.bypassId === previewId);
  const entry = route?.entryConnector.tangentPointFrom;
  const exit = route?.exitConnector.tangentPointTo;
  return entry && exit ? { entry, exit } : null;
}
