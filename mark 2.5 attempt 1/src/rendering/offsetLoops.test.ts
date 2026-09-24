import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type Vec2, cross, sub } from '../math/vector';
import { removeOffsetLoops } from '../math/polyline';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { buildMarkings } from './markings';
import { generateVariableWidthPath } from './segmentPath';

const fixture = JSON.parse(readFileSync(new URL('../utils/tight-turn-fold.json', import.meta.url), 'utf8'));
const config = JSON.parse(fixture.roundabout_config) as RoundaboutConfig;

// Proper (interior) crossing between two non-adjacent polyline edges: the
// fold-over a road edge develops when a turn is tighter than the offset.
function edgesCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const crossAB = (p: Vec2, q: Vec2, r: Vec2) => cross(sub(q, p), sub(r, p));
  const d1 = crossAB(a, b, c);
  const d2 = crossAB(a, b, d);
  const d3 = crossAB(c, d, a);
  const d4 = crossAB(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function hasFold(points: Vec2[]): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (edgesCross(points[i], points[i + 1], points[j], points[j + 1])) return true;
    }
  }
  return false;
}

describe('removeOffsetLoops', () => {
  it('splices a fold-over loop into a single crossing point', () => {
    const folded = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 4, y: 8 }, { x: 4, y: -2 }, { x: 16, y: -2 }, { x: 16, y: 6 }];
    const clean = removeOffsetLoops(folded);
    expect(hasFold(clean)).toBe(false);
    expect(clean[0]).toEqual(folded[0]);
    expect(clean.at(-1)).toEqual(folded.at(-1));
  });

  it('collapses a retraced spike that doubles back without crossing', () => {
    const spiked = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10.2, y: 5 }, { x: 9.8, y: 0.2 }, { x: 20, y: 0 }];
    const clean = removeOffsetLoops(spiked);
    expect(hasFold(clean)).toBe(false);
    for (const point of clean) expect(point.y).toBeLessThan(5.5);
  });

  it('returns fold-free polylines unchanged', () => {
    const smooth = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i / 5) * 3 }));
    expect(removeOffsetLoops(smooth)).toEqual(smooth);
  });
});

describe('tight-turn road rendering', () => {
  const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true, sampleCount: 90 }));

  it('keeps pavement polygons free of fold-over loops', () => {
    for (const segment of segments) {
      const d = generateVariableWidthPath(segment);
      if (!d) continue;
      const numbers = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)!.map(Number);
      const points: Vec2[] = [];
      for (let k = 0; k < numbers.length; k += 2) points.push({ x: numbers[k], y: numbers[k + 1] });
      expect(hasFold(points), `${segment.routeId}#${segment.segIndex} ${segment.kind}`).toBe(false);
    }
  });

  it('keeps white edge and divider markings free of fold-over loops', () => {
    const markings = buildMarkings(config, segments, { yieldSetback: 0 });
    const strokes = markings.filter(marking => marking.kind === 'stroke');
    expect(strokes.length).toBeGreaterThan(0);
    for (const marking of strokes) {
      expect(hasFold(marking.points), marking.id).toBe(false);
    }
  });
});
