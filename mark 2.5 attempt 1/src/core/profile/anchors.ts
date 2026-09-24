import { type RoundaboutConfig, type RoadProfilePoint } from '../../config/types';
import { type RoadEndpoint } from '../routes';
import { compileRoutes } from '../routes';
import { canonicalizeRoadProfile, estimateArmLength, getRoadProfile, interpolateProfile, type ProfileSection } from './model';
import { ensureTaperTipKeys, pruneTaperInteriorKeys } from './authored';
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

  // The first lane to diverge is the one farthest from the roundabout.
  // For 'start' (roundabout at distance 0): maximum tangent distance.
  // For 'end' (roundabout at distance totalLength): minimum tangent distance.
  const distances = divergences[endpoint];
  return endpoint === 'start' ? Math.max(...distances) : Math.min(...distances);
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
    if (arm.authoredProfile) {
      for (const endpoint of ['start', 'end'] as const) {
        const anchor = arm.authoredProfile.median.find(key => key.endAnchor === endpoint);
        if (anchor) anchor.distance = computeEndAnchorDistance(endpoint, geometry, divergences.get(arm.id));
      }
      arm.authoredProfile.median.sort((a, b) => a.distance - b.distance);
      // Keys swallowed by a taper have no effect (the wedge fades from the
      // attachment cross-section) but still render as stray nodes — drop them.
      // Tip keys are the opposite: pinned at the taper's tip distance they hold
      // the tip's offset, materialized at the interpolated value so nothing moves.
      for (const shape of [...arm.authoredProfile.in, ...arm.authoredProfile.out]) {
        pruneTaperInteriorKeys(shape);
        ensureTaperTipKeys(shape);
      }
      delete arm.profile;
      continue;
    }
    arm.profile = getRoadProfile(arm, totalLength);

    for (const endpoint of ['start', 'end'] as const) {
      const correctDistance = computeEndAnchorDistance(endpoint, geometry, divergences.get(arm.id));

      // Only one auto-placed anchor may exist per endpoint; drop stale extras.
      let anchorSeen = false;
      arm.profile = arm.profile.filter(point => {
        if (point.endAnchor !== endpoint) return true;
        if (anchorSeen) return false;
        anchorSeen = true;
        return true;
      });

      const existing = arm.profile.find(p => p.endAnchor === endpoint);
      if (existing) {
        // The ending cross-section always sits exactly at the first divergence
        // (or the road edge when that end touches no ring) — never clamped by
        // other sections; anything beyond it is pruned below instead.
        existing.distance = correctDistance;
      } else {
        // Adopt an unmarked section already sitting at that spot rather than
        // stacking a duplicate on top of it.
        const adoptable = arm.profile.find(p => !p.endAnchor && Math.abs(p.distance - correctDistance) < 1e-6);
        if (adoptable) {
          adoptable.endAnchor = endpoint;
        } else {
          const section: ProfileSection = interpolateProfile([...arm.profile].sort((a, b) => a.distance - b.distance), correctDistance);
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
    }

    // The "propper road" runs between the two ending cross-sections. Sections
    // beyond them — e.g. stranded when an anchor moves inward after a new ring
    // appears on that end — are deleted.
    const startCap = arm.profile.find(p => p.endAnchor === 'start');
    const endCap = arm.profile.find(p => p.endAnchor === 'end');
    if (startCap && endCap) {
      const lower = Math.min(startCap.distance, endCap.distance);
      const upper = Math.max(startCap.distance, endCap.distance);
      arm.profile = arm.profile.filter(point => point.endAnchor || (point.distance >= lower && point.distance <= upper));
    }

    arm.profile = canonicalizeRoadProfile(arm.profile);
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
  const anchorPoint: RoadProfilePoint = {
    id: `${arm.id}_profile_anchor_${endpoint}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    distance: correctDistance,
    medianWidth: section.medianWidth,
    lanesIn: section.lanesIn,
    lanesOut: section.lanesOut,
    endAnchor: endpoint
  };
  // The copy usually sits at the same distance as the fresh anchor. Insert the
  // anchor so the stable sort leaves it outside the copy — 'start' before it,
  // 'end' after it — keeping the copy confined to the propper road.
  const insertAt = endpoint === 'start'
    ? arm.profile.findIndex(p => p.distance >= correctDistance)
    : arm.profile.findIndex(p => p.distance > correctDistance);
  arm.profile.splice(insertAt < 0 ? arm.profile.length : insertAt, 0, anchorPoint);
  arm.profile.sort((a, b) => a.distance - b.distance);
  return next;
}
