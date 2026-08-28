import { describe, expect, it } from 'vitest';
import fixture from '../utils/hard-roundabout.json';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes } from '../core/routes';
import { solveGeometry, type ResolvedSegment } from '../core/solver';
import { buildMarkings } from './markings';
import { boundsIntersect, markingBounds, offsetBounds, resolvedSegmentBounds } from './bounds';

const lineSegment: ResolvedSegment = {
  routeId: 'line',
  segIndex: 0,
  kind: 'entry-line',
  geom: { kind: 'line', p: { x: 0, y: 0 }, u: { x: 1, y: 0 }, t0: 10, t1: 30 },
  color: '#555',
  wStart: 8,
  wEnd: 12,
  source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
};

describe('render bounds', () => {
  it('includes pavement width and treats touching bounds as visible', () => {
    const bounds = resolvedSegmentBounds(lineSegment);
    expect(bounds).toEqual({ minX: 4, minY: -6, maxX: 36, maxY: 6 });
    expect(boundsIntersect(bounds, { minX: 36, minY: -1, maxX: 40, maxY: 1 })).toBe(true);
    expect(boundsIntersect(bounds, { minX: 36.01, minY: -1, maxX: 40, maxY: 1 })).toBe(false);
  });

  it('converts world viewport bounds into translated layer space', () => {
    expect(offsetBounds({ minX: 80, minY: 40, maxX: 120, maxY: 80 }, { x: -100, y: -50 })).toEqual({ minX: -20, minY: -10, maxX: 20, maxY: 30 });
  });

  it('keeps partial arc bounds local to the arc span', () => {
    const segment: ResolvedSegment = {
      ...lineSegment,
      geom: { kind: 'arc', c: { x: 10, y: 20 }, r: 30, a0: 0, a1: Math.PI / 2, dir: 1 },
      wStart: 10,
      wEnd: 10
    };
    const bounds = resolvedSegmentBounds(segment);
    expect(bounds.minX).toBeCloseTo(5);
    expect(bounds.minY).toBeCloseTo(15);
    expect(bounds.maxX).toBeCloseTo(45);
    expect(bounds.maxY).toBeCloseTo(55);
  });

  it('culls most hard-fixture geometry outside a zoomed-in viewport', () => {
    const config = JSON.parse(fixture.roundabout_config) as RoundaboutConfig;
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true, sampleCount: 90 }));
    const markings = buildMarkings(config, segments, { yieldSetback: 6 });
    const visible = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
    const visibleSegments = segments.filter(segment => boundsIntersect(resolvedSegmentBounds(segment), visible));
    const visibleMarkings = markings.filter(marking => boundsIntersect(markingBounds(marking, 1), visible));
    expect(visibleSegments.length).toBeGreaterThan(0);
    expect(visibleSegments.length).toBeLessThan(segments.length / 2);
    expect(visibleMarkings.length).toBeGreaterThan(0);
    expect(visibleMarkings.length).toBeLessThan(markings.length / 2);
  });
});
