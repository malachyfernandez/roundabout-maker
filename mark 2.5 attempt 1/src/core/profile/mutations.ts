import { type RoundaboutConfig } from '../../config/types';
import { estimateArmLength, getRoadProfile, insertProfilePoint, isProfileLanePresent, laneBounds } from './model';

export function setProfileControl(
  original: RoundaboutConfig,
  armId: string,
  pointId: string,
  dir: 'in' | 'out',
  kind: 'median' | 'gap' | 'width',
  value: number,
  laneIndex = 0
): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const pointIndex = arm.profile.findIndex(point => point.id === pointId);
  if (pointIndex < 0) return next;
  const step = dir === 'out' ? 1 : -1;
  if (kind === 'median') {
    const downstreamIndex = pointIndex + step;
    for (const index of [pointIndex, downstreamIndex]) {
      const point = arm.profile[index];
      if (point) point.medianWidth = Math.max(0, value);
    }
    return next;
  }
  const selectedPoint = arm.profile[pointIndex];
  const selectedLane = (dir === 'in' ? selectedPoint.lanesIn : selectedPoint.lanesOut)[laneIndex];
  if (!selectedLane) return next;
  const laneAt = (point: typeof selectedPoint) => (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
  const indices: number[] = [pointIndex];
  if (kind === 'width') {
    const originalWidth = selectedLane.width;
    let cursor = pointIndex + step;
    while (cursor >= 0 && cursor < arm.profile.length) {
      const lane = laneAt(arm.profile[cursor]);
      if (!lane || !isProfileLanePresent(lane) || Math.abs(lane.width - originalWidth) > .01) break;
      indices.push(cursor);
      cursor += step;
    }
    for (const index of indices) {
      const lane = laneAt(arm.profile[index]);
      if (lane) lane.width = Math.max(0, value);
    }
    return next;
  }
  const selectedOriginalOffset = laneBounds(selectedPoint, dir, laneIndex).inner - selectedPoint.medianWidth / 2;
  const delta = value - selectedLane.gap;
  let cursor = pointIndex + step;
  while (cursor >= 0 && cursor < arm.profile.length) {
    const point = arm.profile[cursor];
    const lane = laneAt(point);
    if (!lane || !isProfileLanePresent(lane)) break;
    const offset = laneBounds(point, dir, laneIndex).inner - point.medianWidth / 2;
    if (Math.abs(offset - selectedOriginalOffset) > .01) break;
    indices.push(cursor);
    cursor += step;
  }
  for (const index of indices) {
    const lane = laneAt(arm.profile[index]);
    if (lane) lane.gap = Math.max(0, lane.gap + delta);
  }
  return next;
}

export function moveProfilePoint(original: RoundaboutConfig, armId: string, pointId: string, distance: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const point = arm.profile.find(candidate => candidate.id === pointId);
  if (!point) return next;
  const sorted = [...arm.profile].sort((a, b) => a.distance - b.distance);
  const index = sorted.findIndex(candidate => candidate.id === pointId);
  const lower = index > 0 ? sorted[index - 1].distance + 1 : 0;
  const upper = index < sorted.length - 1 ? sorted[index + 1].distance - 1 : totalLength;
  point.distance = Math.max(lower, Math.min(upper, distance));
  arm.profile.sort((a, b) => a.distance - b.distance);
  return next;
}

export function addProfilePoint(original: RoundaboutConfig, armId: string, distance: number): { config: RoundaboutConfig; pointId: string | null } {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return { config: next, pointId: null };
  const totalLength = estimateArmLength(arm);
  arm.profile = insertProfilePoint(arm, Math.max(0, Math.min(totalLength, distance)), totalLength);
  const point = arm.profile.reduce((best, candidate) => Math.abs(candidate.distance - distance) < Math.abs(best.distance - distance) ? candidate : best);
  return { config: next, pointId: point.id };
}

export function removeProfilePoint(original: RoundaboutConfig, armId: string, pointId: string): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const profile = getRoadProfile(arm, estimateArmLength(arm));
  const target = profile.find(point => point.id === pointId);
  if (!target || target.endAnchor) return next;
  if (profile.length <= 2) return next;
  arm.profile = profile.filter(point => point.id !== pointId);
  return next;
}

export function moveProfileLaneTransition(
  original: RoundaboutConfig,
  armId: string,
  dir: 'in' | 'out',
  laneIndex: number,
  boundaryIndex: number,
  targetBoundaryIndex: number
): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  arm.profile = getRoadProfile(arm, estimateArmLength(arm));
  const source = Math.max(0, Math.min(arm.profile.length - 2, boundaryIndex));
  const target = Math.max(0, Math.min(arm.profile.length - 2, targetBoundaryIndex));
  if (source === target) return next;
  const sourceLanes = dir === 'in' ? arm.profile[source].lanesIn : arm.profile[source].lanesOut;
  const nextLanes = dir === 'in' ? arm.profile[source + 1].lanesIn : arm.profile[source + 1].lanesOut;
  if (isProfileLanePresent(sourceLanes[laneIndex]) === isProfileLanePresent(nextLanes[laneIndex])) return next;
  const templatePoint = target > source ? arm.profile[source] : arm.profile[source + 1];
  const template = structuredClone((dir === 'in' ? templatePoint.lanesIn : templatePoint.lanesOut)[laneIndex] ?? { width: 0, gap: 0 });
  const first = Math.min(source, target) + 1;
  const last = Math.max(source, target);
  for (let index = first; index <= last; index++) {
    const lanes = dir === 'in' ? arm.profile[index].lanesIn : arm.profile[index].lanesOut;
    while (lanes.length <= laneIndex) lanes.push({ width: 0, gap: 0 });
    lanes[laneIndex] = structuredClone(template);
  }
  return next;
}

export function addProfileLane(original: RoundaboutConfig, armId: string, pointId: string, dir: 'in' | 'out', insertIndex: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const start = arm.profile.find(point => point.id === pointId);
  if (!start) return next;
  const topology = dir === 'in' ? arm.lanesIn : arm.lanesOut;
  const index = Math.max(0, Math.min(topology.length, insertIndex));
  if (dir === 'in') {
    const template = arm.lanesIn[Math.min(index, arm.lanesIn.length - 1)];
    arm.lanesIn.splice(index, 0, { sourceRing: template?.sourceRing, targetsRing: template?.targetsRing, filletRadius: template?.filletRadius ?? 40, sourceFilletRadius: template?.sourceFilletRadius, targetFilletRadius: template?.targetFilletRadius, dropsRing: false });
  } else {
    const template = arm.lanesOut[Math.min(index, arm.lanesOut.length - 1)];
    arm.lanesOut.splice(index, 0, { sourceRing: template?.sourceRing, targetsRing: template?.targetsRing, filletRadius: template?.filletRadius ?? 40, sourceFilletRadius: template?.sourceFilletRadius, targetFilletRadius: template?.targetFilletRadius, dropsRing: false });
  }
  for (const point of arm.profile) {
    const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
    const downstream = dir === 'in' ? point.distance <= start.distance : point.distance >= start.distance;
    lanes.splice(index, 0, { width: downstream ? 10 : 0, gap: 0 });
  }
  for (const node of arm.nodes) (dir === 'in' ? node.laneWidthsIn : node.laneWidthsOut).splice(index, 0, 10);
  for (const bypass of next.bypasses ?? []) {
    if (dir === 'in' && bypass.fromArmId === armId && bypass.fromLaneIndex >= index) bypass.fromLaneIndex++;
    if (dir === 'out' && bypass.toArmId === armId && bypass.toLaneIndex >= index) bypass.toLaneIndex++;
  }
  return next;
}

export function removeProfileLane(original: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  (dir === 'in' ? arm.lanesIn : arm.lanesOut).splice(laneIndex, 1);
  for (const node of arm.nodes) (dir === 'in' ? node.laneWidthsIn : node.laneWidthsOut).splice(laneIndex, 1);
  for (const point of arm.profile ?? []) (dir === 'in' ? point.lanesIn : point.lanesOut).splice(laneIndex, 1);
  next.bypasses = (next.bypasses ?? []).filter(bypass => dir === 'in'
    ? bypass.fromArmId !== armId || bypass.fromLaneIndex !== laneIndex
    : bypass.toArmId !== armId || bypass.toLaneIndex !== laneIndex);
  for (const bypass of next.bypasses) {
    if (dir === 'in' && bypass.fromArmId === armId && bypass.fromLaneIndex > laneIndex) bypass.fromLaneIndex--;
    if (dir === 'out' && bypass.toArmId === armId && bypass.toLaneIndex > laneIndex) bypass.toLaneIndex--;
  }
  return next;
}
