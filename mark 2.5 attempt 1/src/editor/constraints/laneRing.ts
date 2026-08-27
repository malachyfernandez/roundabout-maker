import { type RoundaboutConfig } from '../../config/types';
import { type Vec2 } from '../../math/vector';
import { laneIntersectsRingAtEndpoint, laneRoleAtEndpoint, solveLaneRingAttachmentPoint, type RoadEndpoint } from '../../core/routes';

export type LaneRingSnapPoint = { ringId: string; point: Vec2 };

export function getLaneRingSnapPoints(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number, endpoint: RoadEndpoint = 'start'): LaneRingSnapPoint[] {
  return config.rings.map(ring => {
    if (!laneIntersectsRingAtEndpoint(config, armId, dir, laneIndex, ring.id, endpoint)) return null;
    const point = solveLaneRingAttachmentPoint(config, armId, dir, laneIndex, ring.id, endpoint);
    return point ? { ringId: ring.id, point } : null;
  }).filter((point): point is LaneRingSnapPoint => point !== null);
}

export function assignLaneRingTarget(armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, original: RoundaboutConfig, endpoint: RoadEndpoint = 'start'): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const lane = dir === 'in' ? arm.lanesIn[laneIndex] : arm.lanesOut[laneIndex];
  if (!lane) return next;
  if (laneRoleAtEndpoint(dir, endpoint) === 'entry') lane.targetsRing = ringId;
  else lane.sourceRing = ringId;
  if (endpoint === 'start') {
    next.bypasses = next.bypasses?.filter(bypass => dir === 'in'
      ? bypass.fromArmId !== armId || bypass.fromLaneIndex !== laneIndex
      : bypass.toArmId !== armId || bypass.toLaneIndex !== laneIndex);
  }
  return next;
}
