import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../config/types';
import { type ResolvedSegment } from '../core/solver';
import { buildMarkings, type StrokeMarking } from './markings';

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
    expect(ringStrokes.some(marking => marking.dash === '5 5')).toBe(true);
    expect(ringStrokes.some(marking => marking.dash === undefined)).toBe(true);
    const contracted = buildMarkings(config, [ringSegment('right', 100), road], { ringLaneCollisionBuffer: -1.5 });
    expect(contracted.some(marking => marking.kind === 'stroke' && marking.id.startsWith('right_') && marking.dash)).toBe(false);
    const shiftedRoad = { ...road, geom: { kind: 'polyline' as const, points: [{ x: 141, y: -30 }, { x: 141, y: 30 }] } };
    const expanded = buildMarkings(config, [ringSegment('right', 100), shiftedRoad], { ringLaneCollisionBuffer: 1.5 });
    expect(expanded.some(marking => marking.kind === 'stroke' && marking.id.startsWith('right_') && marking.dash)).toBe(true);
  });
});
