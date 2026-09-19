import { type ArmConfig, type ProfileLane, type RoadProfilePoint } from '../../config/types';
import { sampleSpline, type CatmullRomSpline } from '../../math/spline';
import { len, sub } from '../../math/vector';

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
  const laneAt = (index: number, laneIndex: number) =>
    index >= 0 && index < profile.length
      ? (dir === 'in' ? profile[index].lanesIn : profile[index].lanesOut)[laneIndex]
      : undefined;
  for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
    // Boundary -1 is the road's start cap-end, boundary length - 1 is the end
    // cap-end; a lane present at a cap-end gets a transition marker there.
    if (isProfileLanePresent(laneAt(0, laneIndex))) {
      transitions.push({ laneIndex, boundaryIndex: -1, fromPresent: false, toPresent: true });
    }
    for (let boundaryIndex = 0; boundaryIndex < profile.length - 1; boundaryIndex++) {
      const fromPresent = isProfileLanePresent(laneAt(boundaryIndex, laneIndex));
      const toPresent = isProfileLanePresent(laneAt(boundaryIndex + 1, laneIndex));
      if (fromPresent !== toPresent) transitions.push({ laneIndex, boundaryIndex, fromPresent, toPresent });
    }
    if (isProfileLanePresent(laneAt(profile.length - 1, laneIndex))) {
      transitions.push({ laneIndex, boundaryIndex: profile.length - 1, fromPresent: true, toPresent: false });
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
    lanesOut: node.laneWidthsOut.map(width => ({ width, gap: 0 })),
    endAnchor: index === 0 ? 'start' as const : index === arm.nodes.length - 1 ? 'end' as const : undefined
  }));
}

export function getRoadProfile(arm: ArmConfig, totalLength: number): RoadProfilePoint[] {
  const source = arm.profile && arm.profile.length > 0 ? arm.profile : createDefaultProfile(arm, totalLength);
  const sorted = structuredClone(source).sort((a, b) => a.distance - b.distance);
  if (sorted.length === 1) sorted.push({ ...structuredClone(sorted[0]), id: `${sorted[0].id}_end`, distance: totalLength, endAnchor: 'end' as const });
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

export function sampleProfile(arm: ArmConfig, spline: CatmullRomSpline, sampleCount: number): { samples: ReturnType<typeof sampleSpline>; sections: ProfileSection[]; totalLength: number } {
  const samples = sampleSpline(spline, sampleCount);
  const distances = [0];
  for (let i = 1; i < samples.length; i++) distances.push(distances[i - 1] + len(sub(samples[i].p, samples[i - 1].p)));
  const totalLength = distances[distances.length - 1];
  const profile = getRoadProfile(arm, totalLength);
  return { samples, sections: distances.map(distance => interpolateProfile(profile, distance)), totalLength };
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
  const upperIndex = profile.findIndex(point => point.distance >= distance);
  const lower = upperIndex > 0 ? profile[upperIndex - 1] : undefined;
  const upper = upperIndex >= 0 ? profile[upperIndex] : undefined;
  if (lower && upper) {
    // A lane that starts or ends between the neighbors keeps its whole taper in
    // the longer of the two new segments: copy the nearer neighbor's lane state
    // rather than leaving a partial interpolated width at the new point.
    const nearer = distance - lower.distance <= upper.distance - distance ? lower : upper;
    for (const key of ['lanesIn', 'lanesOut'] as const) {
      section[key] = section[key].map((lane, laneIndex) =>
        isProfileLanePresent(lower[key][laneIndex]) === isProfileLanePresent(upper[key][laneIndex])
          ? lane
          : structuredClone(nearer[key][laneIndex] ?? { width: 0, gap: 0 }));
    }
  }
  profile.push({
    id: `${arm.id}_profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    distance,
    medianWidth: section.medianWidth,
    lanesIn: section.lanesIn,
    lanesOut: section.lanesOut
  });
  return profile.sort((a, b) => a.distance - b.distance);
}

export function laneBounds(point: ProfileSection, dir: 'in' | 'out', laneIndex: number) {
  const lanes = dir === 'in' ? point.lanesIn : point.lanesOut;
  let base = point.medianWidth / 2;
  for (let index = 0; index < laneIndex; index++) base += (lanes[index]?.gap ?? 0) + (lanes[index]?.width ?? 0);
  const lane = lanes[laneIndex] ?? { width: 0, gap: 0 };
  const inner = base + lane.gap;
  return { base, inner, outer: inner + lane.width };
}
