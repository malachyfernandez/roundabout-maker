import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { removeProfileLane, removeProfileLanePoint, removeProfileLaneSegment, removeProfilePoint } from '../core/profile';
import { removeArmNode, removeRing } from './constraints';

export function deleteSelectionTargets(original: RoundaboutConfig, selections: SelectionTarget[]) {
  let next = original;
  const removedArms = new Set(selections.filter((target): target is Extract<SelectionTarget, { kind: 'arm' }> => target.kind === 'arm').map(target => target.armId));
  if (removedArms.size) {
    next = structuredClone(next);
    next.arms = next.arms.filter(arm => !removedArms.has(arm.id));
    next.bypasses = (next.bypasses ?? []).filter(bypass => !removedArms.has(bypass.fromArmId) && !removedArms.has(bypass.toArmId));
  }
  for (const target of selections) if (target.kind === 'ring') next = removeRing(next, target.ringId);
  // Lane and segment deletes both can remove a lane, which shifts the lane
  // indices of everything after it — process them together, highest index
  // first, and skip targets whose lane is already gone.
  const laneTargets = selections
    .filter((target): target is Extract<SelectionTarget, { kind: 'lane' | 'lane-segment' }> =>
      (target.kind === 'lane' || target.kind === 'lane-segment') && !removedArms.has(target.armId))
    .sort((a, b) => a.armId.localeCompare(b.armId) || a.dir.localeCompare(b.dir) || b.laneIndex - a.laneIndex);
  const removedLanes = new Set<string>();
  const laneCount = (armId: string, dir: 'in' | 'out') => {
    const arm = next.arms.find(candidate => candidate.id === armId);
    return (dir === 'in' ? arm?.lanesIn : arm?.lanesOut)?.length ?? 0;
  };
  for (const target of laneTargets) {
    const key = `${target.armId}:${target.dir}:${target.laneIndex}`;
    if (removedLanes.has(key)) continue;
    if (target.kind === 'lane') {
      next = removeProfileLane(next, target.armId, target.dir, target.laneIndex);
      removedLanes.add(key);
      continue;
    }
    const before = laneCount(target.armId, target.dir);
    next = removeProfileLaneSegment(next, target.armId, target.fromPointId, target.toPointId, target.dir, target.laneIndex);
    if (laneCount(target.armId, target.dir) < before) removedLanes.add(key);
  }
  const removedPoints = new Set<string>();
  for (const target of selections) {
    if (removedArms.has('armId' in target ? target.armId : '')) continue;
    if (target.kind === 'arm-node') next = removeArmNode(next, target.armId, target.nodeId);
    if (target.kind === 'lane-node' && !removedLanes.has(`${target.armId}:${target.dir}:${target.laneIndex}`)) next = removeProfileLanePoint(next, target.armId, target.pointId, target.dir, target.laneIndex);
    if (target.kind === 'profile-point') {
      const key = `${target.armId}:${target.pointId}`;
      if (removedPoints.has(key)) continue;
      removedPoints.add(key);
      next = removeProfilePoint(next, target.armId, target.pointId);
    }
  }
  return next;
}

export const hasDeletableSelection = (selections: SelectionTarget[]) => selections.some(target =>
  target.kind === 'ring' || target.kind === 'arm' || target.kind === 'arm-node' || target.kind === 'lane' || target.kind === 'lane-segment' || target.kind === 'profile-point' || target.kind === 'lane-node'
);
