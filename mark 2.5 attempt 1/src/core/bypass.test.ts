import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { compileRoutes, solveBypassAttachmentPoints } from './routes';
import { BYPASS_CONNECTOR_MAX_SCORE, resolveBypassLanePoint } from './bypass';
import { type RoundaboutConfig } from '../config/types';
import { type Vec2 } from '../math/vector';
import buggedFixture from '../utils/bugged-bypass-lane.json';
import buggedFixture2 from '../utils/bugged-bypass-connector.json';

function bypassPointsWithRing(center?: { x: number; y: number }) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (center) config.rings.push({ id: 'unrelated', center, radius: 35, width: 12 });
  return solveBypassAttachmentPoints(config, 'east', 0, 'north', 0, 32);
}

describe('bypass preview placement', () => {
  it('is not displaced by a disconnected ring in the bypass quadrant', () => {
    const baseline = bypassPointsWithRing();
    const withUnrelatedRing = bypassPointsWithRing({ x: 120, y: -120 });
    expect(baseline).not.toBeNull();
    expect(withUnrelatedRing).not.toBeNull();
    expect(withUnrelatedRing?.entry.x).toBeCloseTo(baseline!.entry.x, 4);
    expect(withUnrelatedRing?.entry.y).toBeCloseTo(baseline!.entry.y, 4);
    expect(withUnrelatedRing?.exit.x).toBeCloseTo(baseline!.exit.x, 4);
    expect(withUnrelatedRing?.exit.y).toBeCloseTo(baseline!.exit.y, 4);
  });
});

describe('bypass lanePoint live floor', () => {
  const buggedConfig = JSON.parse(buggedFixture.roundabout_config) as RoundaboutConfig;

  it('lifts a lanePoint that violates pavement clearance out along the ring radial', () => {
    // Fixture: example-files/fix-bugged-rightTurnBypass/roundabout-export-BAD.json
    // The stored lanePoint sits inside the exit lane's pavement after the
    // curvy east road was moved; the solved bypass lane collapsed to width 5.
    const route = compileRoutes(buggedConfig, { profileEnabled: true, bypassEnabled: true })
      .find(candidate => candidate.kind === 'bypass' && candidate.bypassId === 'turn_cinu4');
    expect(route?.kind).toBe('bypass');
    if (route?.kind !== 'bypass') return;
    const requested = buggedConfig.bypasses![0].lanePoint;
    expect(route.lane.line.p).not.toEqual(requested);
    // The floor pushed the point out to (34.1, -63.6) — the same spot the
    // hand-fixed export uses — restoring full lane width.
    expect(route.lane.line.p.x).toBeCloseTo(34.1, 0);
    expect(route.lane.line.p.y).toBeCloseTo(-63.6, 0);
    expect(route.lane.width).toBeGreaterThan(8);
    // The stored config still holds the user's requested value untouched.
    expect(buggedConfig.bypasses![0].lanePoint).toEqual({ x: 31.8, y: -58 });
  });

  it('leaves a lanePoint with enough clearance at the requested value', () => {
    const requested = buggedConfig.bypasses![1].lanePoint;
    const route = compileRoutes(buggedConfig, { profileEnabled: true, bypassEnabled: true })
      .find(candidate => candidate.kind === 'bypass' && candidate.bypassId === 'turn_b99e5');
    expect(route?.kind).toBe('bypass');
    if (route?.kind !== 'bypass') return;
    expect(route.lane.line.p.x).toBeCloseTo(requested.x, 4);
    expect(route.lane.line.p.y).toBeCloseTo(requested.y, 4);
  });

  it('lifts a requested point inside ring pavement to the outer edge plus clearance', () => {
    const config: RoundaboutConfig = {
      island: { center: { x: 0, y: 0 }, radius: 10 },
      rings: [{ id: 'r', center: { x: 0, y: 0 }, radius: 35, width: 12 }],
      arms: [],
      circulation: 'ccw'
    };
    const resolved = resolveBypassLanePoint(config, { x: 30, y: 0 }, { lanePaths: [] });
    // Outer edge at 41 + clearance 2 → radial 43 along the (1, 0) ray.
    expect(resolved.x).toBeCloseTo(43, 1);
    expect(resolved.y).toBeCloseTo(0, 1);
  });

  it('releases back to the requested value once it clears every obstacle', () => {
    const config: RoundaboutConfig = {
      island: { center: { x: 0, y: 0 }, radius: 10 },
      rings: [{ id: 'r', center: { x: 0, y: 0 }, radius: 35, width: 12 }],
      arms: [],
      circulation: 'ccw'
    };
    expect(resolveBypassLanePoint(config, { x: 50, y: 0 }, { lanePaths: [] })).toEqual({ x: 50, y: 0 });
  });

  it('lifts a point where connectors cannot attach even though pavement is clear', () => {
    // A viability predicate that only accepts points inside a region stands
    // in for "the connector solve produces on-path tangents here".
    const config: RoundaboutConfig = {
      island: { center: { x: 0, y: 0 }, radius: 10 },
      rings: [{ id: 'r', center: { x: 0, y: 0 }, radius: 35, width: 12 }],
      arms: [],
      circulation: 'ccw'
    };
    const viable = (point: Vec2) => point.x >= 60;
    const resolved = resolveBypassLanePoint(config, { x: 50, y: 0 }, { lanePaths: [], viable });
    expect(resolved.x).toBeGreaterThanOrEqual(60);
    // When the point is already viable, the requested value is untouched.
    expect(resolveBypassLanePoint(config, { x: 60, y: 0 }, { lanePaths: [], viable }))
      .toEqual({ x: 60, y: 0 });
  });
});

describe('bypass connector live floor', () => {
  const buggedConfig2 = JSON.parse(buggedFixture2.roundabout_config) as RoundaboutConfig;

  const tangentDistance = (p: Vec2, points: Vec2[]) => {
    let min = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const e = { x: b.x - a.x, y: b.y - a.y };
      const l2 = e.x * e.x + e.y * e.y;
      const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * e.x + (p.y - a.y) * e.y) / l2));
      min = Math.min(min, Math.hypot(p.x - a.x - e.x * t, p.y - a.y - e.y * t));
    }
    return min;
  };

  it('lifts a pavement-clear lanePoint whose connector tangents fall off the lane paths', () => {
    // Fixture: example-files/fix-bugged-rightTurnBypass/take 2/-bugged on drag.json
    // The stored lanePoint clears all pavement, so the old floor released to
    // it — but the entry connector's tangent point lands ~21 units off the
    // lane path, rendering the bypass "connected to nothing".
    const route = compileRoutes(buggedConfig2, { profileEnabled: true, bypassEnabled: true })
      .find(candidate => candidate.kind === 'bypass');
    expect(route?.kind).toBe('bypass');
    if (route?.kind !== 'bypass') return;
    const requested = buggedConfig2.bypasses![0].lanePoint;
    expect(route.lane.line.p).not.toEqual(requested);
    const dEntry = tangentDistance(route.entryConnector.tangentPointFrom, route.entry.points);
    const dExit = tangentDistance(route.exitConnector.tangentPointTo, route.exit.points);
    expect(dEntry * dEntry + dExit * dExit).toBeLessThanOrEqual(BYPASS_CONNECTOR_MAX_SCORE);
    // The user's stored value survives the lift untouched.
    expect(requested).toEqual({ x: 37.86697196391352, y: -38.00101392339196 });
  });
});
