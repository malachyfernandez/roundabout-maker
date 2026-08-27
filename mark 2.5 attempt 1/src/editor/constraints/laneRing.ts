import { type RoundaboutConfig } from '../../config/types';
import { type Vec2, add, len, scale, sub } from '../../math/vector';
import { solveLaneRingAttachmentPoint } from '../../core/routes';

export type LaneRingSnapPoint = { ringId: string; point: Vec2 };

export function getLaneRingSnapPoints(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number): LaneRingSnapPoint[] {
  return config.rings.map(ring => {
    const point = solveLaneRingAttachmentPoint(config, armId, dir, laneIndex, ring.id);
    if (point) return { ringId: ring.id, point };

    const arm = config.arms.find(candidate => candidate.id === armId);
    const nearNode = arm?.nodes[0];
    if (!nearNode) return null;
    const radial = sub(nearNode.point, ring.center);
    const distance = len(radial);
    const fallback = distance > 0
      ? add(ring.center, scale(radial, ring.radius / distance))
      : { x: ring.center.x + ring.radius, y: ring.center.y };
    return { ringId: ring.id, point: fallback };
  }).filter((point): point is LaneRingSnapPoint => point !== null);
}

export function assignLaneRingTarget(armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (dir === 'in') {
    if (!arm.lanesIn[laneIndex]) return next;
    arm.lanesIn[laneIndex].targetsRing = ringId;
    next.bypasses = next.bypasses?.filter(bypass => bypass.fromArmId !== armId || bypass.fromLaneIndex !== laneIndex);
  } else {
    if (!arm.lanesOut[laneIndex]) return next;
    arm.lanesOut[laneIndex].sourceRing = ringId;
    next.bypasses = next.bypasses?.filter(bypass => bypass.toArmId !== armId || bypass.toLaneIndex !== laneIndex);
  }
  return next;
}
