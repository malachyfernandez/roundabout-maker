import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../config/types';
import { type Vec2, cross, dot, normalize, perpLeft, sub } from '../math/vector';
import { DEFAULT_CONFIG } from './config';
import { compileRoutes, laneRoleAtEndpoint, resolveLaneRing } from './routes';
import { solveGeometry } from './solver';
import { normalizeProfileAnchors } from './profile/anchors';
import { dragLaneFilletRadius } from '../editor/constraints/laneBypass';
import { segmentPoints } from '../rendering/markings';
import nodeInsideRingFixture from '../utils/bugged-node-inside-ring.json';
import flickerFixture from '../utils/flicker-unsteady.json';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  rings: [
    { id: 'left', center: { x: 0, y: 0 }, radius: 30, width: 10 },
    { id: 'right', center: { x: 200, y: 0 }, radius: 30, width: 10 },
    { id: 'unrelated', center: { x: 100, y: 100 }, radius: 30, width: 10 }
  ],
  arms: [{
    id: 'bridge',
    nodes: [
      { id: 'start', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'end', point: { x: 200, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
    ],
    lanesIn: [{ sourceRing: 'right', targetsRing: 'left', filletRadius: 15, dropsRing: false }],
    lanesOut: [{ sourceRing: 'left', targetsRing: 'right', filletRadius: 15, dropsRing: false }]
  }],
  circulation: 'ccw'
};

describe('road endpoint ring attachments', () => {
  it('derives entry and exit roles independently at both physical endpoints', () => {
    expect(laneRoleAtEndpoint('in', 'start')).toBe('entry');
    expect(laneRoleAtEndpoint('in', 'end')).toBe('exit');
    expect(laneRoleAtEndpoint('out', 'start')).toBe('exit');
    expect(laneRoleAtEndpoint('out', 'end')).toBe('entry');
  });

  it('resolves separate rings at both ends without selecting a disconnected ring', () => {
    const arm = config.arms[0];
    expect(resolveLaneRing(config, arm, 'in', 0, 'start')?.id).toBe('left');
    expect(resolveLaneRing(config, arm, 'in', 0, 'end')?.id).toBe('right');
    expect(resolveLaneRing(config, arm, 'out', 0, 'start')?.id).toBe('left');
    expect(resolveLaneRing(config, arm, 'out', 0, 'end')?.id).toBe('right');
  });

  it('compiles entry and exit connectors for both travel directions at both ends', () => {
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true }));
    const has = (dir: 'in' | 'out', endpoint: 'start' | 'end', kind: 'entry-fillet' | 'exit-fillet') => segments.some(segment =>
      segment.source.kind === 'lane'
      && segment.source.armId === 'bridge'
      && segment.source.dir === dir
      && segment.endpoint === endpoint
      && segment.kind === kind
    );
    expect(has('in', 'start', 'entry-fillet')).toBe(true);
    expect(has('in', 'end', 'exit-fillet')).toBe(true);
    expect(has('out', 'start', 'exit-fillet')).toBe(true);
    expect(has('out', 'end', 'entry-fillet')).toBe(true);
  });

  it('never leaves connected lanes without pavement when a multi-lane road is shortened', () => {
    for (const length of [35, 45, 55, 70, 90]) {
      const shortened = structuredClone(DEFAULT_CONFIG);
      shortened.arms = [shortened.arms.find(arm => arm.id === 'north')!];
      shortened.arms[0].nodes[1].point = { x: 0, y: -length };
      const segments = solveGeometry(shortened, compileRoutes(shortened, { profileEnabled: true }));
      for (const dir of ['in', 'out'] as const) {
        for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
          const lines = segments.filter(segment => segment.source.kind === 'lane'
            && segment.source.armId === 'north'
            && segment.source.dir === dir
            && segment.source.laneIndex === laneIndex
            && (segment.kind === 'entry-line' || segment.kind === 'exit-line'));
          expect(lines.length).toBeGreaterThan(0);
          expect(lines.some(segment => {
            const points = segmentPoints(segment);
            return points.length >= 2 && points.some((point, index) => index > 0 && Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > .1);
          })).toBe(true);
        }
      }
    }
  });

  it('edits connector radii independently at the source and target rings', () => {
    const sourceChanged = dragLaneFilletRadius('bridge', 'out', 0, 'start', { x: 1, y: 0 }, { x: 5, y: 0 }, config);
    expect(sourceChanged.arms[0].lanesOut[0].sourceFilletRadius).toBe(20);
    expect(sourceChanged.arms[0].lanesOut[0].targetFilletRadius).toBeUndefined();

    const targetChanged = dragLaneFilletRadius('bridge', 'out', 0, 'end', { x: 1, y: 0 }, { x: 8, y: 0 }, sourceChanged);
    expect(targetChanged.arms[0].lanesOut[0].sourceFilletRadius).toBe(20);
    expect(targetChanged.arms[0].lanesOut[0].targetFilletRadius).toBe(23);
  });
});

describe('stable road junction geometry', () => {
  const base = flickerFixture as RoundaboutConfig;
  const variants = [-1, 0, 1].map(delta => {
    const variant = structuredClone(base);
    variant.arms[0].nodes[1].point.y += delta;
    return variant;
  });

  it('keeps the largest feasible fillet radii continuous through small node movements', () => {
    const radii = variants.map(variant => {
      const routes = compileRoutes(variant, { profileEnabled: true, bypassEnabled: true });
      const fillets = routes.flatMap(route => route.kind === 'through'
        ? [route.entry.fillet, route.exit.fillet]
        : route.kind === 'standalone-entry'
          ? [route.entry.fillet]
          : route.kind === 'standalone-exit'
            ? [route.exit.fillet]
            : []);
      expect(fillets).toHaveLength(4);
      expect(fillets.every(fillet => fillet.arc.r <= 40 && fillet.arc.r > 35)).toBe(true);
      return fillets.map(fillet => fillet.arc.r).sort((a, b) => a - b);
    });
    for (let lane = 0; lane < 4; lane++) {
      const laneRadii = radii.map(values => values[lane]);
      expect(Math.max(...laneRadii) - Math.min(...laneRadii)).toBeLessThan(1);
    }
  });

  it('places the automatic cross-section continuously and idempotently', () => {
    const distances = variants.map(variant => {
      const once = normalizeProfileAnchors(variant);
      const twice = normalizeProfileAnchors(once);
      const distance = once.arms[0].profile!.find(point => point.endAnchor === 'start')!.distance;
      const repeatedDistance = twice.arms[0].profile!.find(point => point.endAnchor === 'start')!.distance;
      expect(repeatedDistance).toBeCloseTo(distance, 6);
      return distance;
    });
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(3);
  });
});

describe('lane strip width under lateral shifts', () => {
  // Straight arm whose out-lane gap ramps 0→30 over the first 30 units, so
  // the lane centerline shears sideways at a 45° gradient. Road-normal
  // offset edges would shrink the strip's real width to width·cos(45°) ≈ 7;
  // edges must offset perpendicular to the lane's own direction instead.
  const shifted: RoundaboutConfig = {
    island: { center: { x: 0, y: 0 }, radius: 15 },
    rings: [],
    circulation: 'ccw',
    arms: [{
      id: 'arm',
      nodes: [
        { id: 'a', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
        { id: 'b', point: { x: 100, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
      ],
      lanesIn: [{ filletRadius: 15 }],
      lanesOut: [{ filletRadius: 15, dropsRing: false }],
      profile: [
        { id: 'p0', distance: 0, medianWidth: 4, lanesIn: [{ width: 10, gap: 0 }], lanesOut: [{ width: 10, gap: 0 }], endAnchor: 'start' },
        { id: 'p1', distance: 30, medianWidth: 4, lanesIn: [{ width: 10, gap: 30 }], lanesOut: [{ width: 10, gap: 30 }] },
        { id: 'p2', distance: 100, medianWidth: 4, lanesIn: [{ width: 10, gap: 30 }], lanesOut: [{ width: 10, gap: 30 }], endAnchor: 'end' }
      ]
    }]
  };

  const shiftedLane = () => {
    const lane = compileRoutes(shifted, { profileEnabled: true })
      .find(route => route.kind === 'profile-lane' && route.dir === 'out' && route.laneIdx === 0);
    if (lane?.kind !== 'profile-lane') throw new Error('expected a standalone lane route');
    return lane;
  };

  it('keeps the lane strip at full width through a sideways shift', () => {
    const { points, boundaries } = shiftedLane();
    // Interior of the ramp: the centerline is straight there, so each edge
    // sits exactly half the authored width off the lane normal.
    for (const index of [10, 14, 18, 22]) {
      const normal = perpLeft(normalize(sub(points[index + 1], points[index - 1])));
      const width = dot(sub(boundaries.left[index], points[index]), normal)
        + dot(sub(points[index], boundaries.right[index]), normal);
      expect(width).toBeCloseTo(10, 5);
    }
  });

  it('miter-joins the edges at the bend instead of biting into the pinched side', () => {
    const { points, boundaries } = shiftedLane();
    // The sharpest vertex is where the offset ramp flattens (distance 30).
    const turnAt = (index: number) => 1 - dot(
      normalize(sub(points[index], points[index - 1])),
      normalize(sub(points[index + 1], points[index]))
    );
    let bend = 1;
    for (let index = 1; index < points.length - 1; index++) {
      if (turnAt(index) > turnAt(bend)) bend = index;
    }
    expect(turnAt(bend)).toBeGreaterThan(0.1);
    const lineDistance = (point: Vec2, a: Vec2, b: Vec2) => Math.abs(cross(normalize(sub(b, a)), sub(point, a)));
    // Both edges keep the true offset distance from the bend's adjacent
    // segments: the inside edge holds its corner, the outside bulges out.
    for (const edge of [boundaries.left[bend], boundaries.right[bend]]) {
      expect(lineDistance(edge, points[bend - 1], points[bend])).toBeCloseTo(5, 5);
      expect(lineDistance(edge, points[bend], points[bend + 1])).toBeCloseTo(5, 5);
    }
  });
});

describe('mid-road node inside the ring junction', () => {
  // Fixture: example-files/bugged when moving node past propper road/bugged.json
  // The north arm's middle node sits inside the main rings' outer edge. A
  // node there must only shape the lane path — lanes still fillet onto the
  // ring at the same junction. Regression: the endpoint path used to be split
  // at the sample-count midpoint, which lands on the middle node of a 3-node
  // arm (the sampler allocates samples per node-span). A node inside the ring
  // swallowed that endpoint's entire half, so the fillet solve saw no points
  // outside the ring and lanes drew on past it.
  const bugged = JSON.parse(nodeInsideRingFixture.roundabout_config) as RoundaboutConfig;

  it('connects every lane to the ring instead of running past it', () => {
    const routes = compileRoutes(bugged, { profileEnabled: true, bypassEnabled: true });
    expect(routes.some(route => route.kind === 'profile-lane' && route.armId === 'north')).toBe(false);
    const segments = solveGeometry(bugged, routes);
    for (const dir of ['in', 'out'] as const) {
      for (let laneIndex = 0; laneIndex < 2; laneIndex++) {
        const attached = segments.some(segment =>
          segment.source.kind === 'lane'
          && segment.source.armId === 'north'
          && segment.source.dir === dir
          && segment.source.laneIndex === laneIndex
          && segment.endpoint === 'start'
          && (segment.kind === 'entry-fillet' || segment.kind === 'exit-fillet')
        );
        expect(attached, `${dir}[${laneIndex}]`).toBe(true);
      }
    }
    // Lane pavement at the junction end stops at the fillet tangent — no
    // points inside the ring's outer edge (|y| < 41 along this arm).
    const lines = segments.filter(segment =>
      segment.source.kind === 'lane'
      && segment.source.armId === 'north'
      && segment.endpoint === 'start'
      && (segment.kind === 'entry-line' || segment.kind === 'exit-line')
    );
    for (const line of lines) {
      for (const point of segmentPoints(line)) {
        expect(point.y).toBeLessThanOrEqual(-41);
      }
    }
  });

  it('restores the proper-road anchor to the lane divergence on load', () => {
    // The stale stored start anchor (distance 34.36) sits inside the ring;
    // the true first divergence is ~58.
    const normalized = normalizeProfileAnchors(structuredClone(bugged));
    const startAnchor = normalized.arms.find(arm => arm.id === 'north')!.profile!
      .find(point => point.endAnchor === 'start')!;
    expect(startAnchor.distance).toBeGreaterThan(45);
  });
});
