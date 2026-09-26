import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { buildMarkings, segmentPoints } from './markings';

describe('dbg', () => {
  it('dumps east markings', () => {
    const raw = JSON.parse(readFileSync('/Users/malachyfernandez/Documents/1-programing/1-apps-and-sites/1-RoudaboutMaker copy/example-files/yellow line/roundabout-export(2).json', 'utf8'));
    const config = normalizeProfileAnchors(JSON.parse(raw.roundabout_config)) as RoundaboutConfig;
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true }));
    const markings = buildMarkings(config, segments);
    for (const seg of segments.filter(s => s.source.kind === 'lane' && s.source.armId === 'east')) {
      const pts = segmentPoints(seg);
      console.log('SEG', seg.kind, seg.routeId, seg.segIndex, 'lane', (seg.source as any).dir, (seg.source as any).laneIndex,
        'pts', pts.length, 'w', seg.wStart.toFixed(1), '->', seg.wEnd.toFixed(1),
        'first', JSON.stringify(pts[0]), 'last', JSON.stringify(pts.at(-1)));
    }
    for (const m of markings) {
      const near = m.points.some(p => p.x > 40 && p.x < 160 && Math.abs(p.y) < 40);
      if (!near) continue;
      const xs = m.points.map(p => p.x), ys = m.points.map(p => p.y);
      console.log(m.id, m.kind, m.color, m.dash ?? '', `bbox x[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}] y[${Math.min(...ys).toFixed(1)},${Math.max(...ys).toFixed(1)}]`, 'first', JSON.stringify(m.points[0]), 'last', JSON.stringify(m.points.at(-1)));
    }
  });
});
