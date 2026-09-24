import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { DEFAULT_CONFIG } from '../core/config';
import { compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { buildMarkings, type StrokeMarking } from './markings';

const minRingClearance = (config: RoundaboutConfig, point: { x: number; y: number }) => {
  return config.rings.reduce((clearance, ring) => {
    const distance = Math.hypot(point.x - ring.center.x, point.y - ring.center.y);
    const innerRadius = Math.max(0, ring.radius - ring.width / 2);
    const outerRadius = ring.radius + ring.width / 2;
    return Math.min(clearance, Math.max(distance - outerRadius, innerRadius - distance));
  }, Infinity);
};

const toothCentroid = (marking: { points: { x: number; y: number }[] }) =>
  marking.points.reduce((sum, point) => ({ x: sum.x + point.x / marking.points.length, y: sum.y + point.y / marking.points.length }), { x: 0, y: 0 });

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 10 },
  rings: [
    { id: 'left', center: { x: -100, y: 0 }, radius: 30, width: 10 },
    { id: 'right', center: { x: 100, y: 0 }, radius: 30, width: 10 }
  ],
  arms: [{
    id: 'road',
    nodes: [
      { id: 'a', point: { x: 135, y: -30 }, medianWidth: 0, laneWidthsIn: [10], laneWidthsOut: [] },
      { id: 'b', point: { x: 135, y: 30 }, medianWidth: 0, laneWidthsIn: [10], laneWidthsOut: [] }
    ],
    lanesIn: [{}],
    lanesOut: []
  }],
  circulation: 'ccw'
};

const ringSegment = (ringId: string, x: number): ResolvedSegment => ({
  routeId: `ring_${ringId}`,
  segIndex: 0,
  kind: 'ring-arc',
  geom: { kind: 'arc', c: { x, y: 0 }, r: 30, a0: 0, a1: Math.PI * 2, dir: 1 },
  color: '#555',
  wStart: 10,
  wEnd: 10,
  source: { kind: 'ring', ringId }
});

describe('independent ring markings', () => {
  it('outlines disconnected rings separately without synthetic separators', () => {
    const markings = buildMarkings(config, [ringSegment('left', -100), ringSegment('right', 100)]);
    const strokes = markings.filter(marking => marking.kind === 'stroke');
    expect(strokes.some(marking => marking.id.includes('turbo_separator') || marking.id.includes('circulatory_outer'))).toBe(false);
    for (const ring of config.rings) {
      const ringStrokes = strokes.filter(marking => marking.id.startsWith(`${ring.id}_`));
      expect(ringStrokes.length).toBe(2);
      const outer = ringStrokes.find(marking => marking.id.includes('_outer_'));
      const inner = ringStrokes.find(marking => marking.id.includes('_inner_'));
      expect(outer?.color).toBe('#f8fafc');
      expect(inner?.color).toBe('#f8fafc');
      expect(outer?.points.every(point => Math.abs(Math.hypot(point.x - ring.center.x, point.y - ring.center.y) - 35) < .01)).toBe(true);
      expect(inner?.points.every(point => Math.abs(Math.hypot(point.x - ring.center.x, point.y - ring.center.y) - 25) < .01)).toBe(true);
    }
    const centers = strokes.filter(marking => marking.id.startsWith('central_component_'));
    expect(new Set(centers.map(marking => marking.id.match(/^central_component_\d+/)?.[0]))).toEqual(new Set(['central_component_0', 'central_component_1']));
    expect(centers.every(marking => marking.color === '#facc15')).toBe(true);
  });

  it('builds one yellow central envelope for a connected set of offset rings', () => {
    const markings = buildMarkings(config, [ringSegment('left', -8), ringSegment('right', 8)]);
    const centers = markings.filter(marking => marking.kind === 'stroke' && marking.id.startsWith('central_component_'));
    expect(centers.length).toBeGreaterThan(0);
    expect(centers.every(marking => marking.id.startsWith('central_component_0'))).toBe(true);
    expect(centers.every(marking => marking.color === '#facc15')).toBe(true);
  });

  it('includes attached connector pavement in the yellow central envelope', () => {
    const ring = ringSegment('right', 0);
    const connector: ResolvedSegment = {
      routeId: 'entry',
      segIndex: 1,
      kind: 'entry-fillet',
      geom: { kind: 'arc', c: { x: 0, y: -30 }, r: 20, a0: 0, a1: Math.PI, dir: 1 },
      color: '#555',
      wStart: 10,
      wEnd: 10,
      ringId: 'right',
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const centers = buildMarkings(config, [ring, connector]).filter(marking => marking.kind === 'stroke' && marking.id.startsWith('central_component_'));
    expect(centers.flatMap(marking => marking.points).some(point => Math.hypot(point.x, point.y) < 20)).toBe(true);
  });

  it('omits directional arrows when a road section is too short to contain one', () => {
    const shortRoad: ResolvedSegment = {
      routeId: 'short-road',
      segIndex: 0,
      kind: 'entry-line',
      geom: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      color: '#555',
      wStart: 10,
      wEnd: 10,
      widths: [10, 10],
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    expect(buildMarkings(config, [shortRoad]).some(marking => marking.id.endsWith('_arrow'))).toBe(false);
  });

  it('dashes only edge runs covered by road or connector pavement', () => {
    const road: ResolvedSegment = {
      routeId: 'road',
      segIndex: 0,
      kind: 'entry-line',
      geom: { kind: 'polyline', points: [{ x: 139, y: -30 }, { x: 139, y: 30 }] },
      color: '#555',
      wStart: 10,
      wEnd: 10,
      widths: [10, 10],
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const markings = buildMarkings(config, [ringSegment('right', 100), road]);
    const ringStrokes = markings.filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.startsWith('right_'));
    expect(ringStrokes.some(marking => marking.dash === '2 4')).toBe(true);
    expect(ringStrokes.some(marking => marking.dash === undefined)).toBe(true);
    const dashedPoints = ringStrokes.filter(marking => marking.dash === '2 4').flatMap(marking => marking.points);
    expect(Math.min(...dashedPoints.map(point => point.x))).toBeCloseTo(134, 2);
    const contracted = buildMarkings(config, [ringSegment('right', 100), road], { ringLaneCollisionBuffer: -1.5 });
    expect(contracted.some(marking => marking.kind === 'stroke' && marking.id.startsWith('right_') && marking.dash)).toBe(false);
    const shiftedRoad = { ...road, geom: { kind: 'polyline' as const, points: [{ x: 141, y: -30 }, { x: 141, y: 30 }] } };
    const expanded = buildMarkings(config, [ringSegment('right', 100), shiftedRoad], { ringLaneCollisionBuffer: 1.5 });
    expect(expanded.some(marking => marking.kind === 'stroke' && marking.id.startsWith('right_') && marking.dash)).toBe(true);
  });

  it('keeps the yellow central envelope solid through connector overlaps', () => {
    const connector: ResolvedSegment = {
      routeId: 'entry',
      segIndex: 1,
      kind: 'entry-fillet',
      geom: { kind: 'arc', c: { x: 100, y: -35 }, r: 20, a0: 0, a1: Math.PI, dir: 1 },
      color: '#555',
      wStart: 10,
      wEnd: 10,
      ringId: 'right',
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const centers = buildMarkings(config, [ringSegment('right', 100), connector]).filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.startsWith('central_component_'));
    expect(centers.length).toBeGreaterThan(0);
    expect(centers.every(marking => marking.dash === undefined)).toBe(true);
  });

  it('removes ring markings from the overlap between connected rings', () => {
    const rings = [ringSegment('left', -8), ringSegment('right', 8)];
    const strokes = buildMarkings(config, rings).filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && (marking.id.startsWith('left_') || marking.id.startsWith('right_')));
    for (const marking of strokes) {
      const otherX = marking.id.startsWith('left_') ? 8 : -8;
      expect(marking.points.every(point => {
        const distance = Math.hypot(point.x - otherX, point.y);
        return distance <= 25.01 || distance >= 34.99;
      })).toBe(true);
    }
  });

  it('draws white on both connector edges while the central envelope overlays shared boundaries', () => {
    const connector: ResolvedSegment = {
      routeId: 'entry',
      segIndex: 1,
      kind: 'entry-fillet',
      geom: { kind: 'arc', c: { x: 100, y: -40 }, r: 20, a0: 0, a1: Math.PI, dir: 1 },
      color: '#555',
      wStart: 10,
      wEnd: 16,
      ringId: 'right',
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const markings = buildMarkings(config, [ringSegment('right', 100), connector]);
    const curves = markings.filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.startsWith('entry_1_curve_'));
    const visibleSides = new Set(curves.map(marking => marking.id.includes('_left_') ? 'left' : 'right'));
    expect(visibleSides).toEqual(new Set(['left', 'right']));
    expect(curves.every(marking => marking.color === '#f8fafc')).toBe(true);
    expect(curves.every(marking => marking.points.every(point => {
      const distance = Math.hypot(point.x - 100, point.y);
      return distance <= 25.01 || distance >= 34.99;
    }))).toBe(true);
    expect(markings.some(marking => marking.kind === 'stroke' && marking.id.startsWith('central_component_') && marking.color === '#facc15')).toBe(true);
  });

  it('short-dashes the inner ring edge where connector pavement crosses it', () => {
    const connector: ResolvedSegment = {
      routeId: 'inner-crossing',
      segIndex: 1,
      kind: 'entry-fillet',
      geom: { kind: 'polyline', points: [{ x: 125, y: -40 }, { x: 125, y: 40 }] },
      color: '#555',
      wStart: 4,
      wEnd: 4,
      widths: [4, 4],
      ringId: 'right',
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const inner = buildMarkings(config, [ringSegment('right', 100), connector]).filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.includes('_inner_short-dashed_'));
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every(marking => marking.dash === '2 4')).toBe(true);
  });
});

describe('standalone taper markings', () => {
  it('keeps every stroke continuous through a lane that starts after the road cap', () => {
    const raw = JSON.parse(readFileSync(new URL('../../../../example-files/rendering bugs/here.json', import.meta.url), 'utf8'));
    const fixture = normalizeProfileAnchors(JSON.parse(raw.roundabout_config)) as RoundaboutConfig;
    const strokes = buildMarkings(
      fixture,
      solveGeometry(fixture, compileRoutes(fixture, { profileEnabled: true, bypassEnabled: true }))
    ).filter((marking): marking is StrokeMarking => marking.kind === 'stroke');

    for (const marking of strokes) {
      for (let i = 1; i < marking.points.length; i++) {
        const jump = Math.hypot(marking.points[i].x - marking.points[i - 1].x, marking.points[i].y - marking.points[i - 1].y);
        expect(jump, `${marking.id} points ${i - 1}-${i}`).toBeLessThan(30);
      }
    }
  });
});

describe('US lane separator patterns', () => {
  it('transitions from solid to short dashes to long dashes away from the ring', () => {
    const twoLaneConfig = structuredClone(config);
    twoLaneConfig.arms[0].lanesIn = [{}, {}];
    twoLaneConfig.arms[0].nodes.forEach(node => { node.laneWidthsIn = [10, 10]; });
    const lane: ResolvedSegment = {
      routeId: 'approach',
      segIndex: 0,
      kind: 'entry-line',
      geom: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      color: '#555',
      wStart: 10,
      wEnd: 10,
      widths: [10, 10],
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 1 }
    };
    const innerLane: ResolvedSegment = {
      ...lane,
      routeId: 'approach-inner',
      geom: { kind: 'polyline', points: [{ x: 0, y: 10 }, { x: 100, y: 10 }] },
      source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    };
    const dividers = buildMarkings(twoLaneConfig, [lane, innerLane]).filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.includes('_divider_'));
    expect(dividers.map(marking => marking.dash)).toEqual([undefined, '2 4', '10 30']);
    expect(dividers.find(marking => marking.id.endsWith('_divider_long'))?.dashOffset).toBe(10);
    expect(dividers.every(marking => marking.width === .5)).toBe(true);
  });
});

describe('median-side yellow edge', () => {
  // East arm pointing +x. For circulation 'ccw' the in-lanes sit at -y and the
  // median edge at y=-2 (medianWidth 4). laneIn0 is the innermost lane and
  // tapers out between x=100 and x=120; laneIn1 stays live to the road end.
  const taperConfig: RoundaboutConfig = {
    island: { center: { x: 0, y: 0 }, radius: 10 },
    circulation: 'ccw',
    rings: [{ id: 'r', center: { x: 0, y: 0 }, radius: 30, width: 10 }],
    arms: [{
      id: 'east',
      nodes: [
        { id: 'a', point: { x: 40, y: 0 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10] },
        { id: 'b', point: { x: 100, y: 0 }, medianWidth: 4, laneWidthsIn: [10, 10], laneWidthsOut: [10] },
        { id: 'c', point: { x: 120, y: 0 }, medianWidth: 4, laneWidthsIn: [0, 10], laneWidthsOut: [10] },
        { id: 'd', point: { x: 160, y: 0 }, medianWidth: 4, laneWidthsIn: [0, 10], laneWidthsOut: [10] }
      ],
      lanesIn: [{ targetsRing: 'r' }, {}],
      lanesOut: [{ sourceRing: 'r', dropsRing: false }]
    }]
  };
  const markings = () => buildMarkings(taperConfig, solveGeometry(taperConfig, compileRoutes(taperConfig, { profileEnabled: true })));
  const innerSideYellows = () => markings().filter((marking): marking is StrokeMarking =>
    marking.kind === 'stroke' && marking.color === '#facc15' && !marking.id.startsWith('central_') && marking.points.every(point => point.y < 0));

  it('moves the yellow median line to the next live lane when the inner lane ends early', () => {
    const yellows = innerSideYellows();
    expect(yellows.length).toBeGreaterThan(0);
    const tail = yellows.flatMap(marking => marking.points).filter(point => point.x > 125);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every(point => Math.abs(point.y + 2) < .2)).toBe(true);
    // The whole in-side median edge stays yellow with no gap at the taper.
    const xs = yellows.flatMap(marking => marking.points).map(point => point.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(42);
    expect(xs.at(-1)!).toBeGreaterThan(158);
    for (let index = 1; index < xs.length; index++) expect(xs[index] - xs[index - 1]).toBeLessThan(5);
  });

  it('keeps the lane divider while the inner lane is still live', () => {
    const dividers = markings().filter((marking): marking is StrokeMarking => marking.kind === 'stroke' && marking.id.includes('_divider_'));
    expect(dividers.length).toBeGreaterThan(0);
    expect(dividers.flatMap(marking => marking.points).every(point => point.x < 125)).toBe(true);
  });

  it('fills the median between the two innermost live lane edges', () => {
    const fills = markings().filter(marking => marking.kind === 'fill' && marking.id.includes('_median'));
    expect(fills.length).toBeGreaterThan(0);
    const points = fills.flatMap(marking => marking.points);
    expect(Math.min(...points.map(point => point.x))).toBeLessThan(42);
    expect(Math.max(...points.map(point => point.x))).toBeGreaterThan(158);
    expect(points.every(point => Math.abs(point.y) <= 2.2)).toBe(true);
    expect(points.some(point => point.y < -1.8)).toBe(true);
    expect(points.some(point => point.y > 1.8)).toBe(true);
  });
});

describe('yield teeth placement', () => {
  const segments = () => solveGeometry(DEFAULT_CONFIG, compileRoutes(DEFAULT_CONFIG, { profileEnabled: true }));

  it('emits yield teeth before the first ring-pavement intersection', () => {
    const markings = buildMarkings(DEFAULT_CONFIG, segments(), { yieldSetback: 6 });
    const teeth = markings.filter(marking => marking.kind === 'fill' && marking.id.includes('_tooth_'));
    expect(teeth.length).toBeGreaterThan(0);
    for (const tooth of teeth) {
      const centroid = toothCentroid(tooth);
      expect(minRingClearance(DEFAULT_CONFIG, centroid)).toBeGreaterThan(0);
    }
  });

  it('moves yield teeth farther from the ring as setback increases', () => {
    const near = buildMarkings(DEFAULT_CONFIG, segments(), { yieldSetback: 2 });
    const far = buildMarkings(DEFAULT_CONFIG, segments(), { yieldSetback: 20 });
    const nearCentroids = near.filter(marking => marking.kind === 'fill' && marking.id.includes('_tooth_')).map(toothCentroid);
    const farCentroids = far.filter(marking => marking.kind === 'fill' && marking.id.includes('_tooth_')).map(toothCentroid);
    expect(nearCentroids.length).toBeGreaterThan(0);
    expect(farCentroids.length).toBeGreaterThan(0);
    const nearestNear = Math.max(...nearCentroids.map(point => minRingClearance(DEFAULT_CONFIG, point)));
    const nearestFar = Math.max(...farCentroids.map(point => minRingClearance(DEFAULT_CONFIG, point)));
    expect(nearestFar).toBeGreaterThan(nearestNear);
  });
});
