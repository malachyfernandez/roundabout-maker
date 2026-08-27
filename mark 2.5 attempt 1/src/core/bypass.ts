import { type ArmConfig, type RightTurnBypass, type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { add, angleOf, cross, dot, norm, perpLeft, scale, sub } from '../math/vector';

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
  const clearance = config.rings.reduce((offset, ring) => Math.max(
    offset,
    dot(ring.center, outwardNormal) + ring.radius + ring.width / 2 + laneHalfWidth + 2
  ), dot(config.island.center, outwardNormal) + 40);
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
