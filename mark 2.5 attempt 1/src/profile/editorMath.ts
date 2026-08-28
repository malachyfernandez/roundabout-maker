import { type RoadProfilePoint } from '../config/types';
import { interpolateProfile, isProfileLanePresent, laneBounds, profileLaneTransitions, type ProfileSection } from '../core/profile';

export type ProfileDirection = 'in' | 'out';
export type ProfileControlKind = 'gap' | 'width';
export type WidthSnapMatch = { dir: ProfileDirection; laneIndex: number };
export type GapSnapMatch = { pointId: string; dir: ProfileDirection; laneIndex: number };

const lanesFor = (point: ProfileSection, dir: ProfileDirection) => dir === 'in' ? point.lanesIn : point.lanesOut;

export function profileLaneTotalOffset(point: ProfileSection, dir: ProfileDirection, laneIndex: number) {
  return laneBounds(point, dir, laneIndex).inner - point.medianWidth / 2;
}

export function profileSideOuter(point: ProfileSection, dir: ProfileDirection) {
  return lanesFor(point, dir).reduce(
    (outer, lane, laneIndex) => isProfileLanePresent(lane) ? Math.max(outer, laneBounds(point, dir, laneIndex).outer) : outer,
    point.medianWidth / 2
  );
}

export function profileTransitionTargets(profile: RoadProfilePoint[], dir: ProfileDirection, laneIndex: number, boundaryIndex: number) {
  const boundaries = profileLaneTransitions(profile, dir)
    .filter(transition => transition.laneIndex === laneIndex)
    .map(transition => transition.boundaryIndex)
    .sort((a, b) => a - b);
  const transitionIndex = boundaries.indexOf(boundaryIndex);
  const first = (boundaries[transitionIndex - 1] ?? -1) + 1;
  const last = (boundaries[transitionIndex + 1] ?? profile.length - 1) - 1;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index).filter(candidate => candidate !== boundaryIndex);
}

export function profileTransitionSection(profile: RoadProfilePoint[], dir: ProfileDirection, laneIndex: number, boundaryIndex: number, sourceBoundary?: number) {
  const distance = (profile[boundaryIndex].distance + profile[boundaryIndex + 1].distance) / 2;
  const section = interpolateProfile(profile, distance);
  if (sourceBoundary !== undefined && boundaryIndex !== sourceBoundary) {
    const sourceTransition = profileLaneTransitions(profile, dir).find(transition => transition.laneIndex === laneIndex && transition.boundaryIndex === sourceBoundary);
    const templatePoint = sourceTransition?.fromPresent ? profile[sourceBoundary] : profile[sourceBoundary + 1];
    const template = templatePoint && lanesFor(templatePoint, dir)[laneIndex];
    if (template) lanesFor(section, dir)[laneIndex] = { width: template.width / 2, gap: template.gap / 2 };
  }
  return section;
}

export function profileControlValue(point: RoadProfilePoint, dir: ProfileDirection, laneIndex: number, control: ProfileControlKind, offset: number) {
  const bounds = laneBounds(point, dir, laneIndex);
  const lane = lanesFor(point, dir)[laneIndex];
  return control === 'gap' ? offset - bounds.base - (lane?.width ?? 0) / 2 : offset - bounds.inner;
}

export function snapProfileLaneWidth(point: RoadProfilePoint, dir: ProfileDirection, laneIndex: number, value: number, threshold = .5) {
  let snappedWidth: number | null = null;
  let snapDistance = Infinity;
  for (const checkDir of ['in', 'out'] as const) {
    lanesFor(point, checkDir).forEach((lane, checkIndex) => {
      if (checkDir === dir && checkIndex === laneIndex || !isProfileLanePresent(lane)) return;
      const distance = Math.abs(value - lane.width);
      if (distance < threshold && distance < snapDistance) {
        snapDistance = distance;
        snappedWidth = lane.width;
      }
    });
  }
  if (snappedWidth === null) return { value, matches: [] as WidthSnapMatch[] };
  const matches: WidthSnapMatch[] = [];
  for (const checkDir of ['in', 'out'] as const) {
    lanesFor(point, checkDir).forEach((lane, checkIndex) => {
      if (isProfileLanePresent(lane) && Math.abs(snappedWidth! - lane.width) < .01) matches.push({ dir: checkDir, laneIndex: checkIndex });
    });
  }
  return { value: snappedWidth, matches };
}

export function snapProfileLaneGap(
  profile: RoadProfilePoint[],
  pointId: string,
  dir: ProfileDirection,
  laneIndex: number,
  totalOffset: number,
  threshold = .5
): { totalOffset: number; matches: GapSnapMatch[] } {
  const index = profile.findIndex(point => point.id === pointId);
  if (index < 0) return { totalOffset, matches: [] };
  const neighbors: number[] = [];
  if (index > 0) neighbors.push(index - 1);
  if (index < profile.length - 1) neighbors.push(index + 1);
  let snappedOffset: number | null = null;
  let snapDistance = Infinity;
  for (const neighborIndex of neighbors) {
    const neighbor = profile[neighborIndex];
    const lane = lanesFor(neighbor, dir)[laneIndex];
    if (!isProfileLanePresent(lane)) continue;
    const candidate = profileLaneTotalOffset(neighbor, dir, laneIndex);
    const distance = Math.abs(totalOffset - candidate);
    if (distance < threshold && distance < snapDistance) {
      snapDistance = distance;
      snappedOffset = candidate;
    }
  }
  if (snappedOffset === null) return { totalOffset, matches: [] };
  const matches: GapSnapMatch[] = [];
  for (const neighborIndex of neighbors) {
    const neighbor = profile[neighborIndex];
    const lane = lanesFor(neighbor, dir)[laneIndex];
    if (isProfileLanePresent(lane) && Math.abs(snappedOffset - profileLaneTotalOffset(neighbor, dir, laneIndex)) < .01) {
      matches.push({ pointId: neighbor.id, dir, laneIndex });
    }
  }
  return { totalOffset: snappedOffset, matches };
}

export function profileLaneInsertIndices(point: RoadProfilePoint, dir: ProfileDirection) {
  const visible = lanesFor(point, dir).flatMap((lane, laneIndex) => isProfileLanePresent(lane) ? [laneIndex] : []);
  return visible.length ? [...visible, visible[visible.length - 1] + 1] : [0];
}

export type LaneStartEndMover = { pointId: string; kind: 'start' | 'end' };

export function profileLaneStartEndMovers(
  profile: RoadProfilePoint[],
  dir: ProfileDirection,
  laneIndex: number,
  selectedIndex: number
): LaneStartEndMover[] {
  const movers: LaneStartEndMover[] = [];
  if (selectedIndex < 0 || selectedIndex >= profile.length) return movers;
  const present = (index: number) => {
    const lane = lanesFor(profile[index], dir)[laneIndex];
    return !!lane && isProfileLanePresent(lane);
  };
  const hasEntry = (index: number) => !!lanesFor(profile[index], dir)[laneIndex];
  if (!present(selectedIndex)) return movers;
  if (selectedIndex > 0 && hasEntry(selectedIndex - 1) && !present(selectedIndex - 1)) {
    movers.push({ pointId: profile[selectedIndex - 1].id, kind: dir === 'out' ? 'start' : 'end' });
  }
  if (selectedIndex < profile.length - 1 && hasEntry(selectedIndex + 1) && !present(selectedIndex + 1)) {
    movers.push({ pointId: profile[selectedIndex + 1].id, kind: dir === 'out' ? 'end' : 'start' });
  }
  return movers;
}
