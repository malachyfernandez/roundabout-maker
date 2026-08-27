import { describe, expect, it } from 'vitest';
import { ringOuterEdgePathIndex } from './ringBoundary';

describe('ring profile boundary', () => {
  it('uses the associated ring center instead of a global radius', () => {
    const points = [
      { x: 48, y: 0 },
      { x: 49, y: 0 },
      { x: 50, y: 0 },
      { x: 51, y: 0 }
    ];
    const ring = { id: 'offset', center: { x: 8, y: 0 }, radius: 35, width: 12 };
    expect(ringOuterEdgePathIndex(points, ring)).toBe(1);
  });
});
