import { type RouteSymbolic, type EntryLeg, type ExitLeg } from './routes';
import { type Segment, type Arc, normalizeAngle } from '../geometry/primitives';
import { type Vec2 } from '../math/vector';
import { sub, len, dot, add, scale } from '../math/vector';
import { type RoundaboutConfig, type SelectionTarget } from './config';

export type ResolvedSegment = {
  routeId: string;
  segIndex: number;
  kind: 'entry-line' | 'entry-fillet' | 'ring-arc' | 'exit-fillet' | 'exit-line';
  geom: Segment;
  color: string;
  wStart: number;
  wEnd: number;
  source: SelectionTarget;
};

function generateHue(index: number, total: number): string {
  const hue = (index * 360) / Math.max(total, 1);
  return `hsl(${hue}, 80%, 50%)`;
}

// Project a point onto a polyline and return the exact interpolated point
// plus the index of the segment it falls on. This avoids the quantization
// that comes from snapping to the nearest sampled vertex.
function projectOntoPolyline(points: Vec2[], target: Vec2): { point: Vec2; segmentIndex: number } | null {
  if (points.length < 2) return null;
  let bestIdx = 0, bestDist = Infinity, bestPoint: Vec2 = points[0];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const ab = sub(b, a);
    const abLen = len(ab);
    if (abLen < 1e-12) continue;
    const t = Math.max(0, Math.min(1, dot(sub(target, a), ab) / (abLen * abLen)));
    const proj = add(a, scale(ab, t));
    const d = len(sub(proj, target));
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
      bestPoint = proj;
    }
  }
  return { point: bestPoint, segmentIndex: bestIdx };
}

// Trim a polyline at the fillet tangent point.
// Polyline points always go center→outward. The fillet tangent point is near
// the center for both entry and exit lanes. The straight road extends from the
// tangent point outward to the far end in both cases — the only difference is
// the direction of travel, not the visible geometry.
// We project the tangent point onto the polyline to get an exact cut point,
// then insert it and slice from there outward.
function trimPolylineAtFillet(points: Vec2[], tangentPoint: Vec2): Vec2[] {
  if (points.length === 0) return points;
  const proj = projectOntoPolyline(points, tangentPoint);
  if (!proj) return points;
  // Build the trimmed polyline: [exactCutPoint, ...rest outward]
  const trimmed = [proj.point, ...points.slice(proj.segmentIndex + 1)];
  return trimmed;
}

function countSegments(routes: RouteSymbolic[]): number {
  return routes.reduce(
    (n, r) => {
      if (r.kind === 'through') return n + 5;
      if (r.kind === 'full-ring') return n + 1;
      return n + 2;
    },
    0
  );
}

export function solveGeometry(
  config: RoundaboutConfig,
  routes: RouteSymbolic[]
): ResolvedSegment[] {
  const resolved: ResolvedSegment[] = [];
  const totalSegs = countSegments(routes);
  let colorIdx = 0;

  const entryWidth = (leg: EntryLeg) => {
    const arm = config.arms.find((a) => a.id === leg.armId)!;
    return arm.nodes[0].laneWidthsIn[leg.laneIdx] || 10;
  };
  const exitWidth = (leg: ExitLeg) => {
    const arm = config.arms.find((a) => a.id === leg.armId)!;
    return arm.nodes[0].laneWidthsOut[leg.laneIdx] || 10;
  };

  const pushEntry = (routeId: string, leg: EntryLeg, ringWidth: number, segIndex: number) => {
    const width = entryWidth(leg);
    // Trim the polyline at the fillet tangent point so the road stops where the turn begins.
    const trimmedPoints = trimPolylineAtFillet(leg.points, leg.fillet.tangentPointLine);
    const entryLineGeom = { kind: 'polyline' as const, points: trimmedPoints };
    const source: SelectionTarget = { kind: 'lane', armId: leg.armId, dir: 'in', laneIndex: leg.laneIdx };

    resolved.push({
      routeId, segIndex, kind: 'entry-line', geom: entryLineGeom,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: width, source
    });
    resolved.push({
      routeId, segIndex: segIndex + 1, kind: 'entry-fillet', geom: leg.fillet.arc,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: ringWidth, source
    });
  };

  const pushExit = (routeId: string, leg: ExitLeg, ringWidth: number, segIndex: number) => {
    const width = exitWidth(leg);
    // Trim the polyline at the fillet tangent point so the road starts where the turn ends.
    const trimmedPoints = trimPolylineAtFillet(leg.points, leg.fillet.tangentPointLine);
    const exitLineGeom = { kind: 'polyline' as const, points: trimmedPoints };
    const source: SelectionTarget = { kind: 'lane', armId: leg.armId, dir: 'out', laneIndex: leg.laneIdx };

    resolved.push({
      routeId, segIndex, kind: 'exit-fillet', geom: leg.fillet.arc,
      color: generateHue(colorIdx++, totalSegs), wStart: ringWidth, wEnd: width, source
    });
    resolved.push({
      routeId, segIndex: segIndex + 1, kind: 'exit-line', geom: exitLineGeom,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: width, source
    });
  };

  for (const route of routes) {
    switch (route.kind) {
      case 'through': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushEntry(route.id, route.entry, ringConfig.width, 0);

        let { a0, a1, dir } = route.ringSpan;
        a0 = normalizeAngle(a0);
        a1 = normalizeAngle(a1);

        let diff = a1 - a0;
        if (dir === 1 && diff < 0) diff += 2 * Math.PI;
        if (dir === -1 && diff > 0) diff -= 2 * Math.PI;
        a1 = a0 + diff;

        const ringArcGeom: Arc = {
          kind: 'arc', c: ringConfig.center, r: ringConfig.radius, a0, a1, dir,
        };

        resolved.push({
          routeId: route.id, segIndex: 2, kind: 'ring-arc', geom: ringArcGeom,
          color: generateHue(colorIdx++, totalSegs),
          wStart: ringConfig.width, wEnd: ringConfig.width,
          source: { kind: 'ring', ringId: route.ringId }
        });

        pushExit(route.id, route.exit, ringConfig.width, 3);
        break;
      }
      case 'standalone-entry': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushEntry(route.id, route.entry, ringConfig.width, 0);
        break;
      }
      case 'standalone-exit': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushExit(route.id, route.exit, ringConfig.width, 0);
        break;
      }
      case 'full-ring': {
        const ringArcGeom: Arc = {
          kind: 'arc', c: route.center, r: route.radius, a0: 0, a1: Math.PI * 2, dir: 1
        };
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        resolved.push({
          routeId: route.id, segIndex: 0, kind: 'ring-arc', geom: ringArcGeom,
          color: generateHue(colorIdx++, totalSegs),
          wStart: ringConfig.width, wEnd: ringConfig.width,
          source: { kind: 'ring', ringId: route.ringId }
        });
        break;
      }
    }
  }

  return resolved;
}
