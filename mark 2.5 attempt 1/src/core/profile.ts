import { type ArmConfig, type ProfileLane, type RoadProfilePoint, type RoundaboutConfig } from '../config/types';
import { sampleSpline, type CatmullRomSpline } from '../math/spline';
import { len, sub } from '../math/vector';

export type ProfileSection = {
  distance: number;
  medianWidth: number;
  lanesIn: ProfileLane[];
  lanesOut: ProfileLane[];
};

export type ProfileLaneTransition = {
  laneIndex: number;
  boundaryIndex: number;
  fromPresent: boolean;
  toPresent: boolean;
};

export function isProfileLanePresent(lane: ProfileLane | undefined) {
  return (lane?.width ?? 0) > .05;
}

export function profileLaneTransitions(profile: RoadProfilePoint[], dir: 'in' | 'out'): ProfileLaneTransition[] {
  const laneCount = Math.max(0, ...profile.map(point => (dir === 'in' ? point.lanesIn : point.lanesOut).length));
  const transitions: ProfileLaneTransition[] = [];
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    for (let boundaryIndex = 0; boundaryIndex < profile.length - 1; boundaryIndex++) {
      const fromPresent = isProfileLanePresent((dir === 'in' ? profile[boundaryIndex].lanesIn : profile[boundaryIndex].lanesOut)[laneIndex]);
      const toPresent = isProfileLanePresent((dir === 'in' ? profile[boundaryIndex + 1].lanesIn : profile[boundaryIndex + 1].lanesOut)[laneIndex]);
      if (fromPresent !== toPresent) transitions.push({ laneIndex, boundaryIndex, fromPresent, toPresent });
    }
  }
  return transitions;
}

function interpolateLane(a: ProfileLane | undefined, b: ProfileLane | undefined, t: number): ProfileLane {
  const from = a ?? { width: 0, gap: 0 };
  const to = b ?? { width: 0, gap: 0 };
  return {
    width: from.width + (to.width - from.width) * t,
    gap: from.gap + (to.gap - from.gap) * t
  };
}

export function estimateArmLength(arm: ArmConfig): number {
  const spline: CatmullRomSpline = { points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 };
  const samples = sampleSpline(spline, 120);
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += len(sub(samples[i].p, samples[i - 1].p));
  return total;
}

export function createDefaultProfile(arm: ArmConfig, totalLength?: number): RoadProfilePoint[] {
  const distances = [0];
  for (let i = 1; i < arm.nodes.length; i++) {
    distances.push(distances[i - 1] + len(sub(arm.nodes[i].point, arm.nodes[i - 1].point)));
  }
  const rawLength = distances[distances.length - 1] || 150;
  const factor = totalLength && rawLength > 0 ? totalLength / rawLength : 1;
  return arm.nodes.map((node, index) => ({
    id: `${arm.id}_profile_${index}`,
    distance: distances[index] * factor,
    medianWidth: node.medianWidth,
    lanesIn: node.laneWidthsIn.map(width => ({ width, gap: 0 })),
    lanesOut: node.laneWidthsOut.map(width => ({ width, gap: 0 }))
  }));
}

export function getRoadProfile(arm: ArmConfig, totalLength: number): RoadProfilePoint[] {
  const source = arm.profile && arm.profile.length > 0 ? arm.profile : createDefaultProfile(arm, totalLength);
  const sorted = structuredClone(source).sort((a, b) => a.distance - b.distance);
  if (sorted.length === 1) sorted.push({ ...structuredClone(sorted[0]), id: `${sorted[0].id}_end`, distance: totalLength });
  return sorted;
}

export function interpolateProfile(profile: RoadProfilePoint[], distance: number): ProfileSection {
  if (profile.length === 0) return { distance, medianWidth: 4, lanesIn: [], lanesOut: [] };
  const target = Math.max(profile[0].distance, Math.min(profile[profile.length - 1].distance, distance));
  let upperIndex = profile.findIndex(point => point.distance >= target);
  if (upperIndex <= 0) {
    const point = profile[0];
    return { distance, medianWidth: point.medianWidth, lanesIn: structuredClone(point.lanesIn), lanesOut: structuredClone(point.lanesOut) };
  }
  if (upperIndex < 0) upperIndex = profile.length - 1;
  const lower = profile[upperIndex - 1];
  const upper = profile[upperIndex];
  const span = upper.distance - lower.distance;
  const t = span > 1e-6 ? (target - lower.distance) / span : 0;
  const inCount = Math.max(lower.lanesIn.length, upper.lanesIn.length);
  const outCount = Math.max(lower.lanesOut.length, upper.lanesOut.length);
  return {
    distance,
    medianWidth: lower.medianWidth + (upper.medianWidth - lower.medianWidth) * t,
    lanesIn: Array.from({ length: inCount }, (_, index) => interpolateLane(lower.lanesIn[index], upper.lanesIn[index], t)),
    lanesOut: Array.from({ length: outCount }, (_, index) => interpolateLane(lower.lanesOut[index], upper.lanesOut[index], t))
  };
}

export function sampleProfile(arm: ArmConfig, spline: CatmullRomSpline, sampleCount: number): { sections: ProfileSection[]; totalLength: number } {
  const samples = sampleSpline(spline, sampleCount);
  const distances = [0];
  for (let i = 1; i < samples.length; i++) distances.push(distances[i - 1] + len(sub(samples[i].p, samples[i - 1].p)));
  const totalLength = distances[distances.length - 1];
  const profile = getRoadProfile(arm, totalLength);
  return { sections: distances.map(distance => interpolateProfile(profile, distance)), totalLength };
}

export function laneOffsetAt(section: ProfileSection, laneIndex: number, isEntry: boolean, isRHD: boolean): number {
  const lanes = isEntry ? section.lanesIn : section.lanesOut;
  let offset = section.medianWidth / 2;
  for (let index = 0; index <= laneIndex; index++) {
    const lane = lanes[index] ?? { width: 0, gap: 0 };
    offset += lane.gap;
    offset += index === laneIndex ? lane.width / 2 : lane.width;
  }
  if (isRHD) return isEntry ? offset : -offset;
  return isEntry ? -offset : offset;
}

export function insertProfilePoint(arm: ArmConfig, distance: number, totalLength: number): RoadProfilePoint[] {
  const profile = getRoadProfile(arm, totalLength);
  const section = interpolateProfile(profile, distance);
  profile.push({
    id: `${arm.id}_profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    distance,
    medianWidth: section.medianWidth,
    lanesIn: section.lanesIn,
    lanesOut: section.lanesOut
  });
  return profile.sort((a, b) => a.distance - b.distance);
}

export function laneBounds(point: RoadProfilePoint, dir: 'in' | 'out', laneIndex: number) {
  const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
  let base = point.medianWidth / 2;
  for (let index = 0; index < laneIndex; index++) base += (lanes[index]?.gap ?? 0) + (lanes[index]?.width ?? 0);
  const lane = lanes[laneIndex] ?? { width: 0, gap: 0 };
  const inner = base + lane.gap;
  return { base, inner, outer: inner + lane.width };
}

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
  const downstreamIndex = pointIndex + (dir === 'out' ? 1 : -1);
  for (const index of [pointIndex, downstreamIndex]) {
    const point = arm.profile[index];
    if (!point) continue;
    if (kind === 'median') point.medianWidth = Math.max(0, value);
    else {
      const lane = (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex];
      if (lane) lane[kind] = Math.max(0, value);
    }
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
  if (profile.length <= 2) return next;
  const sorted = [...profile].sort((a, b) => a.distance - b.distance);
  const index = sorted.findIndex(point => point.id === pointId);
  if (index <= 0 || index >= sorted.length - 1) return next;
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
    arm.lanesIn.splice(index, 0, { targetsRing: template?.targetsRing, filletRadius: template?.filletRadius ?? 40 });
  } else {
    const template = arm.lanesOut[Math.min(index, arm.lanesOut.length - 1)];
    arm.lanesOut.splice(index, 0, { sourceRing: template?.sourceRing, filletRadius: template?.filletRadius ?? 40, dropsRing: false });
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
