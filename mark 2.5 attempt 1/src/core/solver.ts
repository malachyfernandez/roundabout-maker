import { type RouteSymbolic, type EntryLeg, type ExitLeg } from './routes';
import { type Segment, type Arc, normalizeAngle } from '../geometry/primitives';
import { type Vec2 } from '../math/vector';
import { sub, len, dot, add, scale } from '../math/vector';
import { type RoundaboutConfig, type SelectionTarget } from './config';

export type ResolvedSegment = {
  routeId: string;
  segIndex: number;
  kind: 'entry-line' | 'entry-fillet' | 'ring-arc' | 'exit-fillet' | 'exit-line' | 'bypass-entry' | 'bypass-entry-connector' | 'bypass-lane' | 'bypass-exit-connector' | 'bypass-exit';
  geom: Segment;
  color: string;
  wStart: number;
  wEnd: number;
  widths?: number[];
  radiusCenterRate?: Vec2;
  endpoint?: 'start' | 'end';
  ringId?: string;
  source: SelectionTarget;
};

function generateHue(index: number, total: number): string {
  const hue = (index * 360) / Math.max(total, 1);
  return `hsl(${hue}, 85%, 62%)`;
}

// Project a point onto a polyline and return the exact interpolated point
// plus the index of the segment it falls on. This avoids the quantization
// that comes from snapping to the nearest sampled vertex.
function projectOntoPolyline(points: Vec2[], target: Vec2): { point: Vec2; segmentIndex: number; segmentT: number } | null {
  if (points.length < 2) return null;
  let bestIdx = 0, bestDist = Infinity, bestT = 0, bestPoint: Vec2 = points[0];

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
      bestT = t;
      bestPoint = proj;
    }
  }
  return { point: bestPoint, segmentIndex: bestIdx, segmentT: bestT };
}

// Trim a polyline at the fillet tangent point.
// Polyline points always go center→outward. The fillet tangent point is near
// the center for both entry and exit lanes. The straight road extends from the
// tangent point outward to the far end in both cases — the only difference is
// the direction of travel, not the visible geometry.
// We project the tangent point onto the polyline to get an exact cut point,
// then insert it and slice from there outward.
function trimPolylineAtFillet(points: Vec2[], widths: number[], tangentPoint: Vec2): { points: Vec2[]; widths: number[] } {
  if (points.length === 0) return { points, widths };
  const proj = projectOntoPolyline(points, tangentPoint);
  if (!proj) return { points, widths };
  // Build the trimmed polyline: [exactCutPoint, ...rest outward]
  const trimmedPoints = [proj.point, ...points.slice(proj.segmentIndex + 1)];
  const startWidth = (widths[proj.segmentIndex] ?? widths[0] ?? 10) * (1 - proj.segmentT)
    + (widths[proj.segmentIndex + 1] ?? widths.at(-1) ?? 10) * proj.segmentT;
  const trimmedWidths = [startWidth, ...widths.slice(proj.segmentIndex + 1)];
  return { points: trimmedPoints, widths: trimmedWidths };
}

function trimInvisibleLaneEnds(points: Vec2[], widths: number[]): { points: Vec2[]; widths: number[] } {
  const firstVisible = widths.findIndex(width => width > .05);
  if (firstVisible < 0) return { points: [], widths: [] };
  let lastVisible = widths.length - 1;
  while (lastVisible > firstVisible && (widths[lastVisible] ?? 0) <= .05) lastVisible--;
  const start = Math.max(0, firstVisible - 1);
  const end = Math.min(points.length, lastVisible + 2);
  return { points: points.slice(start, end), widths: widths.slice(start, end) };
}

function countSegments(routes: RouteSymbolic[]): number {
  return routes.reduce(
    (n, r) => {
      if (r.kind === 'through') return n + 5;
      if (r.kind === 'profile-lane') return n + 1;
      if (r.kind === 'bypass') return n + 5;
      if (r.kind === 'full-ring') return n + 1;
      return n + 2;
    },
    0
  );
}

export function solveGeometry(
  config: RoundaboutConfig,
  routes: RouteSymbolic[],
): ResolvedSegment[] {
  const resolved: ResolvedSegment[] = [];
  const totalSegs = countSegments(routes);
  let colorIdx = 0;

  const entryWidth = (leg: EntryLeg) => {
    // Use the lane path's near-end width (already orientation-normalized in compileRoutes).
    return leg.widths[0] ?? 10;
  };
  const exitWidth = (leg: ExitLeg) => {
    return leg.widths[0] ?? 10;
  };

  const pushEntry = (routeId: string, leg: EntryLeg, ringWidth: number, segIndex: number, ringId: string) => {
    // Trim the polyline at the fillet tangent point so the road stops where the turn begins.
    const atFillet = trimPolylineAtFillet(leg.points, leg.widths, leg.fillet.tangentPointLine);
    const trimmed = trimInvisibleLaneEnds(atFillet.points, atFillet.widths);
    const width = trimmed.widths[0] ?? entryWidth(leg);
    const entryLineGeom = { kind: 'polyline' as const, points: trimmed.points };
    const source: SelectionTarget = { kind: 'lane', armId: leg.armId, dir: leg.dir, laneIndex: leg.laneIdx };

    resolved.push({
      routeId, segIndex, kind: 'entry-line', geom: entryLineGeom,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: width, widths: trimmed.widths, endpoint: leg.endpoint, source
    });
    resolved.push({
      routeId, segIndex: segIndex + 1, kind: 'entry-fillet', geom: leg.fillet.arc,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: ringWidth, endpoint: leg.endpoint, ringId, source
    });
  };

  const pushExit = (routeId: string, leg: ExitLeg, ringWidth: number, segIndex: number, ringId: string) => {
    // Trim the polyline at the fillet tangent point so the road starts where the turn ends.
    const atFillet = trimPolylineAtFillet(leg.points, leg.widths, leg.fillet.tangentPointLine);
    const trimmed = trimInvisibleLaneEnds(atFillet.points, atFillet.widths);
    const width = trimmed.widths[0] ?? exitWidth(leg);
    const exitLineGeom = { kind: 'polyline' as const, points: trimmed.points };
    const source: SelectionTarget = { kind: 'lane', armId: leg.armId, dir: leg.dir, laneIndex: leg.laneIdx };

    resolved.push({
      routeId, segIndex, kind: 'exit-fillet', geom: leg.fillet.arc,
      color: generateHue(colorIdx++, totalSegs), wStart: ringWidth, wEnd: width, endpoint: leg.endpoint, ringId, source
    });
    resolved.push({
      routeId, segIndex: segIndex + 1, kind: 'exit-line', geom: exitLineGeom,
      color: generateHue(colorIdx++, totalSegs), wStart: width, wEnd: width, widths: trimmed.widths, endpoint: leg.endpoint, source
    });
  };

  for (const route of routes) {
    switch (route.kind) {
      case 'profile-lane': {
        const source: SelectionTarget = { kind: 'lane', armId: route.armId, dir: route.dir, laneIndex: route.laneIdx };
        const trimmed = trimInvisibleLaneEnds(route.points, route.widths);
        if (trimmed.points.length < 2) break;
        resolved.push({
          routeId: route.id,
          segIndex: 0,
          kind: route.dir === 'in' ? 'entry-line' : 'exit-line',
          geom: { kind: 'polyline', points: trimmed.points },
          color: generateHue(colorIdx++, totalSegs),
          wStart: trimmed.widths[0] ?? 0,
          wEnd: trimmed.widths.at(-1) ?? 0,
          widths: trimmed.widths,
          source
        });
        break;
      }
      case 'bypass': {
        const entrySource: SelectionTarget = { kind: 'lane', armId: route.entry.armId, dir: 'in', laneIndex: route.entry.laneIdx };
        const exitSource: SelectionTarget = { kind: 'lane', armId: route.exit.armId, dir: 'out', laneIndex: route.exit.laneIdx };
        const entry = trimPolylineAtFillet(route.entry.points, route.entry.widths, route.entryConnector.tangentPointFrom);
        const exit = trimPolylineAtFillet(route.exit.points, route.exit.widths, route.exitConnector.tangentPointTo);
        const entryWidth = entry.widths[0] ?? 10;
        const exitWidth = exit.widths[0] ?? 10;
        resolved.push({
          routeId: route.id, segIndex: 0, kind: 'bypass-entry',
          geom: { kind: 'polyline', points: entry.points },
          color: generateHue(colorIdx++, totalSegs),
          wStart: entryWidth, wEnd: entryWidth,
          widths: entry.widths, source: entrySource
        });
        resolved.push({
          routeId: route.id, segIndex: 1, kind: 'bypass-entry-connector',
          geom: route.entryConnector.arc,
          color: generateHue(colorIdx++, totalSegs),
          wStart: entryWidth, wEnd: route.lane.width,
          radiusCenterRate: route.entryConnector.centerRate, source: entrySource
        });
        resolved.push({
          routeId: route.id, segIndex: 2, kind: 'bypass-lane',
          geom: route.lane.line,
          color: generateHue(colorIdx++, totalSegs),
          wStart: route.lane.width, wEnd: route.lane.width, source: entrySource
        });
        resolved.push({
          routeId: route.id, segIndex: 3, kind: 'bypass-exit-connector',
          geom: route.exitConnector.arc,
          color: generateHue(colorIdx++, totalSegs),
          wStart: route.lane.width, wEnd: exitWidth,
          radiusCenterRate: route.exitConnector.centerRate, source: exitSource
        });
        resolved.push({
          routeId: route.id, segIndex: 4, kind: 'bypass-exit',
          geom: { kind: 'polyline', points: exit.points },
          color: generateHue(colorIdx++, totalSegs),
          wStart: exitWidth, wEnd: exitWidth,
          widths: exit.widths, source: exitSource
        });
        break;
      }
      case 'through': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushEntry(route.id, route.entry, ringConfig.width, 0, route.ringId);

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
          ringId: route.ringId,
          source: { kind: 'ring', ringId: route.ringId }
        });

        pushExit(route.id, route.exit, ringConfig.width, 3, route.ringId);
        break;
      }
      case 'standalone-entry': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushEntry(route.id, route.entry, ringConfig.width, 0, route.ringId);
        break;
      }
      case 'standalone-exit': {
        const ringConfig = config.rings.find((r) => r.id === route.ringId)!;
        pushExit(route.id, route.exit, ringConfig.width, 0, route.ringId);
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
          ringId: route.ringId,
          source: { kind: 'ring', ringId: route.ringId }
        });
        break;
      }
    }
  }

  return resolved;
}
