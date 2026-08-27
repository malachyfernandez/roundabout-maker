import { type RingConfig, type RoundaboutConfig } from '../../config/types';
import { type Vec2, dot, len, scale, sub } from '../../math/vector';
import { laneFilletRadiusAtEndpoint, laneRoleAtEndpoint, type RoadEndpoint } from '../../core/routes';

export function dragLaneFilletRadius(armId: string, dir: 'in' | 'out', laneIndex: number, endpoint: RoadEndpoint, centerRate: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  const source = original.arms.find(candidate => candidate.id === armId);
  if (!arm || !source) return next;
  const lanes = dir === 'in' ? arm.lanesIn : arm.lanesOut;
  const sourceLanes = dir === 'in' ? source.lanesIn : source.lanesOut;
  if (!lanes[laneIndex] || !sourceLanes[laneIndex]) return next;
  const radius = laneFilletRadiusAtEndpoint(source, dir, laneIndex, endpoint);
  const rateSquared = dot(centerRate, centerRate);
  const radiusDelta = rateSquared > 1e-9 ? dot(delta, centerRate) / rateSquared : 0;
  const nextRadius = Math.max(5, Math.round((radius + radiusDelta) * 10) / 10);
  if (laneRoleAtEndpoint(dir, endpoint) === 'entry') lanes[laneIndex].targetFilletRadius = nextRadius;
  else lanes[laneIndex].sourceFilletRadius = nextRadius;
  return next;
}

export function dragBypassConnectorRadius(bypassId: string, connector: 'entry' | 'exit', centerRate: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  const rateSquared = dot(centerRate, centerRate);
  const radiusDelta = rateSquared > 1e-9 ? dot(delta, centerRate) / rateSquared : 0;
  const sourceRadius = connector === 'entry' ? source.entryRadius ?? source.radius ?? 32 : source.exitRadius ?? source.radius ?? 32;
  const radius = Math.max(2, Math.min(200, Math.round((sourceRadius + radiusDelta) * 10) / 10));
  if (connector === 'entry') bypass.entryRadius = radius;
  else bypass.exitRadius = radius;
  return next;
}

export function nearestRingOuterEdge(rings: RingConfig[], point: Vec2) {
  return rings.reduce<RingConfig | undefined>((nearest, ring) => {
    if (!nearest) return ring;
    const gap = Math.abs(len(sub(point, ring.center)) - ring.radius - ring.width / 2);
    const nearestGap = Math.abs(len(sub(point, nearest.center)) - nearest.radius - nearest.width / 2);
    return gap < nearestGap ? ring : nearest;
  }, undefined);
}

export function dragBypassLanePoint(bypassId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  // Restrict movement to the radial direction of the ring associated with this
  // bypass by proximity. This conserves space without assuming one global ring.
  const ring = nearestRingOuterEdge(original.rings, source.lanePoint);
  const center = ring?.center ?? original.island.center;
  const radial = sub(source.lanePoint, center);
  const radialLen = len(radial);
  const radialDir = radialLen > 1e-9 ? scale(radial, 1 / radialLen) : { x: 1, y: 0 };
  const radialDelta = dot(delta, radialDir);
  const newRadial = radialLen + radialDelta;
  bypass.lanePoint = {
    x: Math.round((center.x + radialDir.x * newRadial) * 10) / 10,
    y: Math.round((center.y + radialDir.y * newRadial) * 10) / 10
  };
  return next;
}

export function dragBypassLaneAngle(bypassId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  // Compute the angle change from the drag delta projected onto the
  // perpendicular of the original lane direction. The rotation handle
  // sits 30 units along the lane direction from the placement point.
  const originalDir = { x: Math.cos(source.laneAngle), y: Math.sin(source.laneAngle) };
  const perp = { x: -originalDir.y, y: originalDir.x };
  const angularDelta = dot(delta, perp) / 30;
  bypass.laneAngle = source.laneAngle + angularDelta;
  return next;
}
