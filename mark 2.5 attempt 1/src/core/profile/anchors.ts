import { type RoundaboutConfig, type RoadProfilePoint } from '../../config/types';
import { type RoadEndpoint } from '../routes';
import { compileRoutes } from '../routes';
import { estimateArmLength, getRoadProfile, interpolateProfile, type ProfileSection } from './model';
import { profileGeometry, projectProfileDistance, type ProfileGeometry } from '../../profile/worldGeometry';
import { type Vec2 } from '../../math/vector';

type EndpointDivergences = { start: number[]; end: number[] };

function collectDivergenceDistances(config: RoundaboutConfig, geometryByArm: Map<string, ProfileGeometry>): Map<string, EndpointDivergences> {
  const routes = compileRoutes(config, { profileEnabled: true, bypassEnabled: true });
  const result = new Map<string, EndpointDivergences>();

  const ensure = (armId: string) => {
    let entry = result.get(armId);
    if (!entry) { entry = { start: [], end: [] }; result.set(armId, entry); }
    return entry;
  };

  const project = (armId: string, point: Vec2): number | null => {
    const geometry = geometryByArm.get(armId);
    if (!geometry) return null;
    return projectProfileDistance(geometry, point);
  };

  for (const route of routes) {
    if (route.kind === 'through') {
      const d1 = project(route.entry.armId, route.entry.fillet.tangentPointLine);
      if (d1 !== null) ensure(route.entry.armId)[route.entry.endpoint].push(d1);
      const d2 = project(route.exit.armId, route.exit.fillet.tangentPointLine);
      if (d2 !== null) ensure(route.exit.armId)[route.exit.endpoint].push(d2);
    } else if (route.kind === 'standalone-entry') {
      const d = project(route.entry.armId, route.entry.fillet.tangentPointLine);
      if (d !== null) ensure(route.entry.armId)[route.entry.endpoint].push(d);
    } else if (route.kind === 'standalone-exit') {
      const d = project(route.exit.armId, route.exit.fillet.tangentPointLine);
      if (d !== null) ensure(route.exit.armId)[route.exit.endpoint].push(d);
    } else if (route.kind === 'bypass') {
      // Bypass entry lane diverges at tangentPointFrom; exit lane diverges at tangentPointTo.
      // Bypass connections are at the 'start' endpoint (roundabout-facing end).
      const entryDist = project(route.entry.armId, route.entryConnector.tangentPointFrom);
      if (entryDist !== null) ensure(route.entry.armId).start.push(entryDist);
      const exitDist = project(route.exit.armId, route.exitConnector.tangentPointTo);
      if (exitDist !== null) ensure(route.exit.armId).start.push(exitDist);
    }
  }

  return result;
}

export function computeEndAnchorDistance(
  endpoint: RoadEndpoint,
  geometry: ProfileGeometry,
  divergences: EndpointDivergences | undefined
): number {
  const totalLength = geometry.totalLength;
  const roadEnd = endpoint === 'start' ? 0 : totalLength;

  if (!divergences || divergences[endpoint].length === 0) return roadEnd;

  // The last lane to diverge is the one closest to the roundabout.
  // For 'start' (roundabout at distance 0): minimum tangent distance.
  // For 'end' (roundabout at distance totalLength): maximum tangent distance.
  const distances = divergences[endpoint];
  return endpoint === 'start' ? Math.min(...distances) : Math.max(...distances);
}

export function normalizeProfileAnchors(config: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(config);
  const geometryByArm = new Map<string, ProfileGeometry>();
  for (const arm of next.arms) {
    if (arm.nodes.length < 2) continue;
    geometryByArm.set(arm.id, profileGeometry(arm));
  }
  const divergences = collectDivergenceDistances(next, geometryByArm);

  for (const arm of next.arms) {
    if (arm.nodes.length < 2) continue;
    const geometry = geometryByArm.get(arm.id)!;
    const totalLength = geometry.totalLength;
    arm.profile = getRoadProfile(arm, totalLength);

    for (const endpoint of ['start', 'end'] as const) {
      const correctDistance = computeEndAnchorDistance(endpoint, geometry, divergences.get(arm.id));

      // Find existing anchor for this endpoint
      const existing = arm.profile.find(p => p.endAnchor === endpoint);
      if (existing) {
        // Clamp to not overlap with neighboring non-anchor points
        const sorted = [...arm.profile].sort((a, b) => a.distance - b.distance);
        const others = sorted.filter(p => p.endAnchor !== endpoint);
        if (endpoint === 'start') {
          const upper = others.length > 0 ? others[0].distance - 1 : totalLength;
          existing.distance = Math.min(correctDistance, upper);
        } else {
          const lower = others.length > 0 ? others[others.length - 1].distance + 1 : 0;
          existing.distance = Math.max(correctDistance, lower);
        }
      } else {
        // Add a new anchor at the correct position, interpolating cross-section
        const section: ProfileSection = interpolateProfile(arm.profile, correctDistance);
        const anchorPoint: RoadProfilePoint = {
          id: `${arm.id}_profile_anchor_${endpoint}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
          distance: correctDistance,
          medianWidth: section.medianWidth,
          lanesIn: section.lanesIn,
          lanesOut: section.lanesOut,
          endAnchor: endpoint
        };
        arm.profile.push(anchorPoint);
      }
    }

    arm.profile.sort((a, b) => a.distance - b.distance);
  }

  return next;
}

export function convertAnchorToCopy(original: RoundaboutConfig, armId: string, pointId: string): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  const totalLength = estimateArmLength(arm);
  arm.profile = getRoadProfile(arm, totalLength);
  const point = arm.profile.find(p => p.id === pointId);
  if (!point?.endAnchor) return next;

  const endpoint = point.endAnchor;
  point.endAnchor = undefined; // becomes a regular point

  // Compute correct anchor position and add a new anchor
  const geometry = profileGeometry(arm);
  const divergences = collectDivergenceDistances(next, new Map([[arm.id, geometry]]));
  const correctDistance = computeEndAnchorDistance(endpoint, geometry, divergences.get(arm.id));
  const section = interpolateProfile(arm.profile, correctDistance);
  arm.profile.push({
    id: `${arm.id}_profile_anchor_${endpoint}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    distance: correctDistance,
    medianWidth: section.medianWidth,
    lanesIn: section.lanesIn,
    lanesOut: section.lanesOut,
    endAnchor: endpoint
  });
  arm.profile.sort((a, b) => a.distance - b.distance);
  return next;
}
