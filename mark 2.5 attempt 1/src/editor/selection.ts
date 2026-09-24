import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { estimateArmLength, getRoadProfile } from '../core/profile/model';
import { findLanePoint } from '../core/profile/authored';

export const selectionKey = (target: SelectionTarget) => {
  switch (target.kind) {
    case 'island': return 'island';
    case 'ring': return `ring:${target.ringId}`;
    case 'arm': return `arm:${target.armId}`;
    case 'arm-node': return `arm-node:${target.armId}:${target.nodeId}`;
    case 'lane': return `lane:${target.armId}:${target.dir}:${target.laneIndex}`;
    case 'profile-point': return `profile-point:${target.armId}:${target.pointId}`;
    case 'profile-control': return `profile-control:${target.armId}:${target.pointId}:${target.dir}:${target.control}:${target.laneIndex}`;
    case 'lane-node': return `lane-node:${target.armId}:${target.pointId}:${target.dir}:${target.laneIndex}`;
    case 'lane-segment': return `lane-segment:${target.armId}:${target.fromPointId}:${target.toPointId}:${target.dir}:${target.laneIndex}`;
  }
};

export const sameSelectionTarget = (a: SelectionTarget | null, b: SelectionTarget | null) =>
  a === b || Boolean(a && b && selectionKey(a) === selectionKey(b));

export const sameSelectionClass = (a: SelectionTarget, b: SelectionTarget) => a.kind === b.kind;

export const oneSelectionClass = (selections: SelectionTarget[], primary?: SelectionTarget | null) => {
  const selectionClass = primary?.kind ?? selections[selections.length - 1]?.kind;
  return selectionClass ? selections.filter(target => target.kind === selectionClass) : [];
};

export const selectionArmId = (target: SelectionTarget | null) => target && 'armId' in target ? target.armId : null;

// Roads currently in the selection scope. While any are selected, clicks and
// hover outside them only drop the selection instead of retargeting, and
// everything not belonging to those roads renders dimmed.
export const focusedArmIds = (selections: SelectionTarget[]) =>
  new Set(selections.flatMap(target => 'armId' in target ? [target.armId] : []));

export const selectionExists = (config: RoundaboutConfig, target: SelectionTarget) => {
  if (target.kind === 'island') return true;
  if (target.kind === 'ring') return config.rings.some(ring => ring.id === target.ringId);
  const arm = config.arms.find(candidate => candidate.id === target.armId);
  if (!arm) return false;
  if (target.kind === 'arm') return true;
  if (target.kind === 'arm-node') return arm.nodes.some(node => node.id === target.nodeId);
  if (target.kind === 'lane') return target.laneIndex < (target.dir === 'in' ? arm.lanesIn.length : arm.lanesOut.length);
  const profile = getRoadProfile(arm, estimateArmLength(arm));
  if (target.kind === 'lane-segment') {
    return Boolean(
      findLanePoint(arm, profile, target.dir, target.laneIndex, target.fromPointId)
      && findLanePoint(arm, profile, target.dir, target.laneIndex, target.toPointId)
    );
  }
  const point = target.kind === 'lane-node' || target.kind === 'profile-control'
    ? findLanePoint(arm, profile, target.dir, target.laneIndex, target.pointId)
    : profile.find(candidate => candidate.id === target.pointId);
  if (!point) return false;
  if (target.kind === 'profile-point') return true;
  return Boolean((target.dir === 'in' ? point.lanesIn : point.lanesOut)[target.laneIndex]);
};

export const repairSelections = (config: RoundaboutConfig, selections: SelectionTarget[]) => {
  const repaired: SelectionTarget[] = [];
  for (const target of selections) {
    let candidate: SelectionTarget | null = selectionExists(config, target) ? target : null;
    if (!candidate && (target.kind === 'lane-node' || target.kind === 'profile-control' || target.kind === 'lane-segment')) {
      const lane: SelectionTarget = { kind: 'lane', armId: target.armId, dir: target.dir, laneIndex: target.laneIndex };
      if (selectionExists(config, lane)) candidate = lane;
    }
    if (!candidate && 'armId' in target && config.arms.some(arm => arm.id === target.armId)) candidate = { kind: 'arm', armId: target.armId };
    if (candidate && !repaired.some(item => sameSelectionTarget(item, candidate))) repaired.push(candidate);
  }
  return repaired;
};
