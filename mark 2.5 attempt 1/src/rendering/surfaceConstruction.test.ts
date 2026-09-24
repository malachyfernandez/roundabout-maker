import { describe, expect, it } from 'vitest';
import { type ResolvedSegment } from '../core/solver';
import { generateSegmentSurface } from './segmentPath';

const polylineSegment = (overrides: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  routeId: 'lane',
  segIndex: 0,
  kind: 'entry-line',
  geom: { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }] },
  color: '#555',
  wStart: 0,
  wEnd: 10,
  widths: [0, 10, 10],
  source: { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 },
  boundaries: {
    left: [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 }],
    right: [{ x: 0, y: 0 }, { x: 10, y: -5 }, { x: 20, y: -5 }]
  },
  ...overrides
});

describe('surface construction', () => {
  it('terminates a taper at the authored tip exactly once', () => {
    const surface = generateSegmentSurface(polylineSegment());
    expect(surface.runs).toHaveLength(1);
    const run = surface.runs[0];
    expect(run.left[0]).toEqual({ x: 0, y: 0 });
    expect(run.right[0]).toEqual({ x: 0, y: 0 });
    expect(run.left.slice(1).every(point => point.y > 0)).toBe(true);
    expect(run.right.slice(1).every(point => point.y < 0)).toBe(true);
  });

  it('does not project a taper tip back onto an earlier road cap', () => {
    const surface = generateSegmentSurface(polylineSegment({
      startCap: { p: { x: -5, y: 0 }, outward: { x: -1, y: 0 } }
    }));
    const run = surface.runs[0];
    expect(run.left[0]).toEqual({ x: 0, y: 0 });
    expect(run.right[0]).toEqual({ x: 0, y: 0 });
  });

  it('clips stray boundary vertices to a shared road-end line', () => {
    const cap = { p: { x: 15, y: 0 }, outward: { x: 1, y: 0 } };
    const surface = generateSegmentSurface(polylineSegment({
      widths: [10, 10, 10],
      boundaries: {
        left: [{ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 20, y: 5 }],
        right: [{ x: 0, y: -5 }, { x: 10, y: -5 }, { x: 20, y: -5 }]
      },
      endCap: cap
    }));
    const run = surface.runs[0];
    expect(run.left.at(-1)).toEqual({ x: 15, y: 5 });
    expect(run.right.at(-1)).toEqual({ x: 15, y: -5 });
    expect([...run.left, ...run.right].filter(point => Math.abs(point.x - 15) < 1e-6)).toHaveLength(2);
  });
});
