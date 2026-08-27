import { type RoadProfilePoint } from '../config/types';
import { interpolateProfile, isProfileLanePresent, laneBounds, profileLaneTransitions, type ProfileSection } from '../core/profile';

export type ProfileDirection = 'in' | 'out';
export type ProfileControlKind = 'gap' | 'width';
export type WidthSnapMatch = { dir: ProfileDirection; laneIndex: number };

const lanesFor = (point: ProfileSection, dir: ProfileDirection) => dir === 'in' ? point.lanesIn : point.lanesOut;

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

export function profileLaneInsertIndices(point: RoadProfilePoint, dir: ProfileDirection) {
  const visible = lanesFor(point, dir).flatMap((lane, laneIndex) => isProfileLanePresent(lane) ? [laneIndex] : []);
  return visible.length ? [...visible, visible[visible.length - 1] + 1] : [0];
}
