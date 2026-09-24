import { type ArmConfig, type ProfileLane, type RoadProfilePoint } from '../../config/types';
import { sampleSpline, type CatmullRomSpline } from '../../math/spline';
import { add, len, norm, perpLeft, scale, sub, type Vec2 } from '../../math/vector';
import { deriveRoadProfile } from './authored';

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
    gap: from.gap + (to.gap - from.gap) * t,
    node: false
  };
}

const laneAt = (point: ProfileSection | undefined, dir: 'in' | 'out', laneIndex: number) =>
  point ? (dir === 'in' ? point.lanesIn : point.lanesOut)[laneIndex] : undefined;

export function assignProfileLaneNodeOwnership(profile: RoadProfilePoint[]) {
  for (const dir of ['in', 'out'] as const) {
    const laneCount = Math.max(0, ...profile.map(point => (dir === 'in' ? point.lanesIn : point.lanesOut).length));
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
      for (let index = 0; index < profile.length; index++) {
        const lane = laneAt(profile[index], dir, laneIndex);
        if (!lane || lane.node !== undefined) continue;
        const upstreamIndex = dir === 'out' ? index - 1 : index + 1;
        const upstream = profile[upstreamIndex] && laneAt(profile[upstreamIndex], dir, laneIndex);
        const previous = profile[index - 1] && laneAt(profile[index - 1], dir, laneIndex);
        const next = profile[index + 1] && laneAt(profile[index + 1], dir, laneIndex);
        const terminalAttachment = Boolean(
          previous && isProfileLanePresent(previous) !== isProfileLanePresent(lane)
          || next && isProfileLanePresent(next) !== isProfileLanePresent(lane)
        );
        lane.node = !profile[index].endAnchor && isProfileLanePresent(lane) && Boolean(terminalAttachment || upstream && (
          Math.abs(upstream.width - lane.width) > .01
          || Math.abs(upstream.gap - lane.gap) > .01
        ));
      }
    }
  }
  return profile;
}

export const isProfileLaneNodeOwner = (point: ProfileSection, dir: 'in' | 'out', laneIndex: number) => laneAt(point, dir, laneIndex)?.node === true;

export function isProfileLaneNodeAffected(profile: RoadProfilePoint[], pointIndex: number, dir: 'in' | 'out', laneIndex: number) {
  if (!isProfileLanePresent(laneAt(profile[pointIndex], dir, laneIndex))) return false;
  for (let innerIndex = 0; innerIndex <= laneIndex; innerIndex++) {
    if (isProfileLaneNodeOwner(profile[pointIndex], dir, innerIndex)) return true;
    const present = isProfileLanePresent(laneAt(profile[pointIndex], dir, innerIndex));
    const previousPresent = isProfileLanePresent(laneAt(profile[pointIndex - 1], dir, innerIndex));
    const nextPresent = isProfileLanePresent(laneAt(profile[pointIndex + 1], dir, innerIndex));
    if (present && (pointIndex > 0 && previousPresent !== present || pointIndex < profile.length - 1 && nextPresent !== present)) return true;
  }
  return false;
}

export function authoredLaneNodeVisible(profile: RoadProfilePoint[], index: number, dir: 'in' | 'out', laneIndex: number): boolean {
  const point = profile[index];
  if (!point || point.endAnchor || !isProfileLanePresent(laneAt(point, dir, laneIndex))) return false;
  if (isProfileLaneNodeOwner(point, dir, laneIndex)) return true;
  const previous = profile[index - 1];
  const next = profile[index + 1];
  if (!previous || !next || point.distance <= previous.distance || next.distance <= point.distance) return false;
  const offset = (section: ProfileSection) => {
    const { inner, outer } = laneBounds(section, dir, laneIndex);
    return (inner + outer) / 2;
  };
  const before = (offset(point) - offset(previous)) / (point.distance - previous.distance);
  const after = (offset(next) - offset(point)) / (next.distance - point.distance);
  return Math.abs(before - after) > 1e-4;
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
    lanesIn: node.laneWidthsIn.map(width => ({ width, gap: 0, node: false })),
    lanesOut: node.laneWidthsOut.map(width => ({ width, gap: 0, node: false })),
    endAnchor: index === 0 ? 'start' as const : index === arm.nodes.length - 1 ? 'end' as const : undefined
  }));
}

export function pruneOrphanProfileStations(profile: RoadProfilePoint[]) {
  return profile.filter(point => !point.id.includes('_station_') || [...point.lanesIn, ...point.lanesOut].some(lane => lane.node === true));
}

export function getRoadProfile(arm: ArmConfig, totalLength: number): RoadProfilePoint[] {
  if (arm.authoredProfile) return deriveRoadProfile(arm.authoredProfile);
  const source = arm.profile && arm.profile.length > 0 ? arm.profile : createDefaultProfile(arm, totalLength);
  const sorted = pruneOrphanProfileStations(structuredClone(source)).sort((a, b) => a.distance - b.distance);
  if (sorted.length === 1) sorted.push({ ...structuredClone(sorted[0]), id: `${sorted[0].id}_end`, distance: totalLength, endAnchor: 'end' as const });
  return assignProfileLaneNodeOwnership(sorted);
}

const laneValueEqual = (a: ProfileLane | undefined, b: ProfileLane | undefined) =>
  Math.abs((a?.width ?? 0) - (b?.width ?? 0)) <= .01
  && Math.abs((a?.gap ?? 0) - (b?.gap ?? 0)) <= .01
  && isProfileLanePresent(a) === isProfileLanePresent(b);

const sectionValueEqual = (point: RoadProfilePoint, section: ProfileSection) => {
  if (Math.abs(point.medianWidth - section.medianWidth) > .01) return false;
  for (const key of ['lanesIn', 'lanesOut'] as const) {
    const count = Math.max(point[key].length, section[key].length);
    for (let laneIndex = 0; laneIndex < count; laneIndex++) {
      if (!laneValueEqual(point[key][laneIndex], section[key][laneIndex])) return false;
    }
  }
  return true;
};

export function canonicalizeRoadProfile(source: RoadProfilePoint[]) {
  let profile = assignProfileLaneNodeOwnership(structuredClone(source).sort((a, b) => a.distance - b.distance));
  const laneOwnedPointIds = new Set(profile.flatMap(point =>
    point.id.includes('_profile_terminal_') || point.id.includes('_station_') || [...point.lanesIn, ...point.lanesOut].some(lane => lane.node)
      ? [point.id]
      : []
  ));
  for (const point of profile) {
    const without = profile.filter(candidate => candidate.id !== point.id);
    const derived = without.length >= 2 ? interpolateProfile(without, point.distance) : null;
    for (const key of ['lanesIn', 'lanesOut'] as const) {
      for (let laneIndex = 0; laneIndex < point[key].length; laneIndex++) {
        const lane = point[key][laneIndex];
        if (lane.fresh) {
          delete lane.fresh;
          continue;
        }
        if (lane.node && derived && laneValueEqual(lane, derived[key][laneIndex])) lane.node = false;
      }
    }
  }

  let changed = true;
  while (changed && profile.length > 2) {
    changed = false;
    const removable = new Set(profile.flatMap(point => {
      if (!laneOwnedPointIds.has(point.id) || point.endAnchor || [...point.lanesIn, ...point.lanesOut].some(lane => lane.node)) return [];
      const without = profile.filter(candidate => candidate.id !== point.id);
      if (without.length < 2) return [];
      return sectionValueEqual(point, interpolateProfile(without, point.distance)) ? [point.id] : [];
    }));
    if (removable.size) {
      profile = profile.filter(point => !removable.has(point.id));
      changed = true;
    }
  }
  return profile;
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

export function profileSampleFrameAt(samples: { p: Vec2; tangent: Vec2; normal: Vec2 }[], distances: number[], distance: number) {
  const target = Math.max(0, Math.min(distances[distances.length - 1], distance));
  const upper = distances.findIndex(candidate => candidate >= target);
  if (upper <= 0) return samples[0];
  const a = samples[upper - 1];
  const b = samples[upper];
  const t = (target - distances[upper - 1]) / Math.max(1e-6, distances[upper] - distances[upper - 1]);
  const tangent = norm(add(scale(a.tangent, 1 - t), scale(b.tangent, t)));
  return { p: add(scale(a.p, 1 - t), scale(b.p, t)), tangent, normal: norm(perpLeft(tangent)) };
}

export function sampleProfile(arm: ArmConfig, spline: CatmullRomSpline, sampleCount: number): { samples: ReturnType<typeof sampleSpline>; sections: ProfileSection[]; totalLength: number; distances: number[]; profile: RoadProfilePoint[] } {
  const baseSamples = sampleSpline(spline, sampleCount);
  const baseDistances = [0];
  for (let i = 1; i < baseSamples.length; i++) baseDistances.push(baseDistances[i - 1] + len(sub(baseSamples[i].p, baseSamples[i - 1].p)));
  const totalLength = baseDistances[baseDistances.length - 1];
  const profile = getRoadProfile(arm, totalLength);
  // Land samples exactly on taper boundaries — the sections where a lane's
  // presence flips — so wedges are drawn with their own straight lines to the
  // tip instead of being quantized onto nearby uniform samples.
  const extras: number[] = [];
  const pushExtra = (distance: number) => {
    if (distance <= 1e-4 || distance >= totalLength - 1e-4) return;
    if (baseDistances.some(base => Math.abs(base - distance) < 1e-4)) return;
    if (extras.some(extra => Math.abs(extra - distance) < 1e-4)) return;
    extras.push(distance);
  };
  for (const key of ['lanesIn', 'lanesOut'] as const) {
    for (let index = 0; index < profile.length - 1; index++) {
      const count = Math.max(profile[index][key].length, profile[index + 1][key].length);
      for (let laneIndex = 0; laneIndex < count; laneIndex++) {
        if (isProfileLanePresent(profile[index][key][laneIndex]) === isProfileLanePresent(profile[index + 1][key][laneIndex])) continue;
        pushExtra(profile[index].distance);
        pushExtra(profile[index + 1].distance);
      }
    }
  }
  if (!extras.length) return { samples: baseSamples, sections: baseDistances.map(distance => interpolateProfile(profile, distance)), totalLength, distances: baseDistances, profile };
  const distances = [...baseDistances, ...extras].sort((a, b) => a - b);
  const samples: { p: Vec2; tangent: Vec2; normal: Vec2 }[] = [];
  let cursor = 0;
  for (const distance of distances) {
    while (cursor < baseDistances.length - 1 && baseDistances[cursor + 1] < distance - 1e-9) cursor++;
    const nextIndex = Math.min(cursor + 1, baseSamples.length - 1);
    const a = baseSamples[cursor];
    const b = baseSamples[nextIndex];
    const span = baseDistances[nextIndex] - baseDistances[cursor];
    const t = span > 1e-9 ? Math.max(0, Math.min(1, (distance - baseDistances[cursor]) / span)) : 0;
    const tangent = norm(add(scale(a.tangent, 1 - t), scale(b.tangent, t)));
    samples.push({ p: add(scale(a.p, 1 - t), scale(b.p, t)), tangent, normal: perpLeft(tangent) });
  }
  return { samples, sections: distances.map(distance => interpolateProfile(profile, distance)), totalLength, distances, profile };
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
    lanesIn: section.lanesIn.map(lane => ({ ...lane, node: false })),
    lanesOut: section.lanesOut.map(lane => ({ ...lane, node: false }))
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
