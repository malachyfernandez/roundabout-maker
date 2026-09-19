import { type ArmConfig, type RingConfig, type RightTurnBypass, type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { add, angleOf, cross, dot, len, norm, perpLeft, scale, sub, type Vec2 } from '../math/vector';
import { numericFloorLift, resolveLiveFloor } from './liveFloor';

type LaneTarget = Extract<SelectionTarget, { kind: 'lane' }>;

function outwardDirection(arm: ArmConfig) {
  if (arm.nodes.length < 2) return { x: 0, y: 0 };
  return norm(sub(arm.nodes[arm.nodes.length - 1].point, arm.nodes[0].point));
}

export function isRightTurnPair(source: ArmConfig | undefined, target: ArmConfig | undefined) {
  if (!source || !target || source.id === target.id) return false;
  const incoming = scale(outwardDirection(source), -1);
  const outgoing = outwardDirection(target);
  return cross(incoming, outgoing) > 0.25;
}

export function isValidBypassLanePair(config: RoundaboutConfig, source: LaneTarget | null, target: LaneTarget | null) {
  if (!source || !target || source.dir === target.dir) return false;
  const entry = source.dir === 'in' ? source : target;
  const exit = source.dir === 'out' ? source : target;
  const entryArm = config.arms.find(arm => arm.id === entry.armId);
  const exitArm = config.arms.find(arm => arm.id === exit.armId);
  return Boolean(
    entryArm?.lanesIn[entry.laneIndex]
    && exitArm?.lanesOut[exit.laneIndex]
    && isRightTurnPair(entryArm, exitArm)
  );
}

export function createRightTurnBypass(config: RoundaboutConfig, entry: LaneTarget, exit: LaneTarget, radius = 32, id = `turn_${Math.random().toString(36).slice(2, 7)}`): RightTurnBypass | null {
  const entryArm = config.arms.find(arm => arm.id === entry.armId);
  const exitArm = config.arms.find(arm => arm.id === exit.armId);
  if (!entryArm || !exitArm) return null;
  const entryOut = outwardDirection(entryArm);
  const exitOut = outwardDirection(exitArm);
  let direction = norm(sub(exitOut, entryOut));
  if (!direction.x && !direction.y) direction = perpLeft(entryOut);
  const betweenArms = norm(add(entryOut, exitOut));
  let outwardNormal = perpLeft(direction);
  if (dot(outwardNormal, betweenArms) < 0) outwardNormal = scale(outwardNormal, -1);
  const entryWidth = Math.max(10, ...entryArm.nodes.map(node => node.laneWidthsIn[entry.laneIndex] ?? 0), ...(entryArm.profile ?? []).map(point => point.lanesIn[entry.laneIndex]?.width ?? 0));
  const exitWidth = Math.max(10, ...exitArm.nodes.map(node => node.laneWidthsOut[exit.laneIndex] ?? 0), ...(exitArm.profile ?? []).map(point => point.lanesOut[exit.laneIndex]?.width ?? 0));
  const laneHalfWidth = Math.max(entryWidth, exitWidth) / 2;
  const endpoints = [entryArm.nodes[0].point, exitArm.nodes[0].point];
  const localRings = config.rings.filter(ring => endpoints.some(point => {
    const dx = point.x - ring.center.x;
    const dy = point.y - ring.center.y;
    return Math.hypot(dx, dy) <= ring.radius + ring.width / 2 + laneHalfWidth;
  }));
  const endpointClearance = Math.max(...endpoints.map(point => dot(point, outwardNormal))) + 40;
  const clearance = localRings.reduce((offset, ring) => Math.max(
    offset,
    dot(ring.center, outwardNormal) + ring.radius + ring.width / 2 + laneHalfWidth + 2
  ), endpointClearance);
  return {
    id,
    fromArmId: entry.armId,
    fromLaneIndex: entry.laneIndex,
    toArmId: exit.armId,
    toLaneIndex: exit.laneIndex,
    entryRadius: radius,
    exitRadius: radius,
    lanePoint: scale(outwardNormal, clearance),
    laneAngle: angleOf(direction)
  };
}

export function nearestRingOuterEdge(rings: RingConfig[], point: Vec2) {
  return rings.reduce<RingConfig | undefined>((nearest, ring) => {
    if (!nearest) return ring;
    const gap = Math.abs(len(sub(point, ring.center)) - ring.radius - ring.width / 2);
    const nearestGap = Math.abs(len(sub(point, nearest.center)) - nearest.radius - nearest.width / 2);
    return gap < nearestGap ? ring : nearest;
  }, undefined);
}

/**
 * Minimum gap (world units) required between a bypass lanePoint and any
 * surrounding pavement edge: lane pavement, ring outer edges, and the
 * center island. Below this the connector solve degenerates — tangent
 * points can land on zero-width lane sections and the bypass lane's
 * pavement ends up inside the lanes it bypasses.
 */
export const BYPASS_LANE_POINT_CLEARANCE = 2;

/**
 * Maximum connector-solve score that still counts as a viable placement.
 * The score is the sum of squared distances from each connector's tangent
 * point to the lane path it should attach to. A tangent that lands off the
 * path (score ≫ 1) renders as a bypass "connected to nothing", so viability
 * requires the tangent to sit essentially on the lane polyline.
 */
export const BYPASS_CONNECTOR_MAX_SCORE = 4;

const FLOOR_COARSE_STEP = 2;
const FLOOR_FINE_STEP = 0.25;
const FLOOR_MAX_TRAVEL = 800;

/** A lane centerline path plus its per-sample widths — the pavement obstacle
 *  a bypass lanePoint must stay clear of. */
export type LanePointObstacle = { points: Vec2[]; widths: number[] };

export type BypassLanePointFloorContext = {
  /** Lane paths the point must keep BYPASS_LANE_POINT_CLEARANCE from. */
  lanePaths: Iterable<LanePointObstacle>;
  /**
   * Extra viability predicate evaluated at candidate positions — e.g.
   * "the bypass connectors can actually attach here". A floor candidate
   * must be viable AND keep its pavement clearance, and viability must
   * persist one coarse step further out so the floor never stops on a
   * knife-edge where the solve flickers in and out.
   */
  viable?: (point: Vec2) => boolean;
};

function pointToSegmentDistance(point: Vec2, a: Vec2, b: Vec2) {
  const edge = sub(b, a);
  const edgeLengthSquared = dot(edge, edge);
  const t = edgeLengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), edge) / edgeLengthSquared));
  return len(sub(point, add(a, scale(edge, t))));
}

/** Distance from a point to a lane path's pavement edge (negative = inside). */
function lanePavementDistance(point: Vec2, path: LanePointObstacle) {
  let min = Infinity;
  const { points, widths } = path;
  for (let i = 0; i < points.length - 1; i++) {
    const halfWidth = ((widths[i] ?? 0) + (widths[i + 1] ?? 0)) / 4;
    if (halfWidth < 0.025) continue; // zero-width stretches have no pavement
    min = Math.min(min, pointToSegmentDistance(point, points[i], points[i + 1]) - halfWidth);
  }
  return min;
}

export type BypassLanePointFloor = {
  /** Center the placement ray is measured from (nearest ring, else island). */
  center: Vec2;
  /** Unit direction from `center` through the requested point. */
  dir: Vec2;
  /** Minimum radial distance from `center` that clears all pavement. */
  radius: number;
};

/**
 * Live Floor for a bypass lanePoint — see docs/LIVE-FLOOR.md.
 *
 * Returns null when the requested point already clears every lane path,
 * ring outer edge, and the island by BYPASS_LANE_POINT_CLEARANCE. Otherwise
 * walks the point outward along the same radial ray the lane-point drag
 * uses (from the nearest ring's center through the requested point) until
 * every obstacle is clear, then reports that radius as the floor. Checking
 * ALL obstacles each step matters: escaping one lane can push the point
 * into another.
 */
export function bypassLanePointFloor(
  config: RoundaboutConfig,
  requested: Vec2,
  context: BypassLanePointFloorContext
): BypassLanePointFloor | null {
  const { lanePaths, viable } = context;
  const paths = [...lanePaths];
  const clearanceAt = (point: Vec2) => {
    let clearance = len(sub(point, config.island.center)) - config.island.radius;
    for (const ring of config.rings) {
      clearance = Math.min(clearance, len(sub(point, ring.center)) - ring.radius - ring.width / 2);
    }
    for (const path of paths) clearance = Math.min(clearance, lanePavementDistance(point, path));
    return clearance;
  };
  const ok = (point: Vec2) => clearanceAt(point) >= BYPASS_LANE_POINT_CLEARANCE && (!viable || viable(point));
  if (ok(requested)) return null;
  const center = nearestRingOuterEdge(config.rings, requested)?.center ?? config.island.center;
  const radial = sub(requested, center);
  const radialLength = len(radial);
  const dir = radialLength > 1e-9 ? scale(radial, 1 / radialLength) : { x: 1, y: 0 };
  const at = (radius: number): Vec2 => ({ x: center.x + dir.x * radius, y: center.y + dir.y * radius });
  const limit = radialLength + FLOOR_MAX_TRAVEL;
  for (let radius = radialLength + FLOOR_COARSE_STEP; radius <= limit; radius += FLOOR_COARSE_STEP) {
    if (!ok(at(radius)) || !ok(at(radius + FLOOR_COARSE_STEP))) continue;
    for (let fine = radius - FLOOR_COARSE_STEP + FLOOR_FINE_STEP; fine <= radius; fine += FLOOR_FINE_STEP) {
      if (ok(at(fine))) return { center, dir, radius: fine };
    }
    return { center, dir, radius };
  }
  return { center, dir, radius: limit };
}

/**
 * Resolved lanePoint for a bypass: the user's requested point, lifted along
 * its ring radial to the live floor when the floor is above it. The stored
 * config value is never touched, so the user's placement is restored as
 * soon as surrounding geometry moves back out of the way.
 */
export function resolveBypassLanePoint(
  config: RoundaboutConfig,
  requested: Vec2,
  context: BypassLanePointFloorContext
): Vec2 {
  const floor = bypassLanePointFloor(config, requested, context);
  if (!floor) return requested;
  const requestedRadius = len(sub(requested, floor.center));
  const resolvedRadius = resolveLiveFloor(requestedRadius, floor.radius, numericFloorLift).resolved;
  const point = { x: floor.center.x + floor.dir.x * resolvedRadius, y: floor.center.y + floor.dir.y * resolvedRadius };
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
}

export function connectBypassLanes(config: RoundaboutConfig, source: LaneTarget, target: LaneTarget, radius = 32): RoundaboutConfig | null {
  if (!isValidBypassLanePair(config, source, target)) return null;
  const entry = source.dir === 'in' ? source : target;
  const exit = source.dir === 'out' ? source : target;
  const bypass = createRightTurnBypass(config, entry, exit, radius);
  if (!bypass) return null;
  const next = structuredClone(config);
  next.bypasses = (next.bypasses ?? []).filter(candidate =>
    (candidate.fromArmId !== entry.armId || candidate.fromLaneIndex !== entry.laneIndex)
    && (candidate.toArmId !== exit.armId || candidate.toLaneIndex !== exit.laneIndex)
  );
  next.bypasses.push(bypass);
  return next;
}
