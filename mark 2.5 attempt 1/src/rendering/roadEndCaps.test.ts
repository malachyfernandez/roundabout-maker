import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { type RoundaboutConfig } from '../config/types';
import { type CapLine, compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { generateVariableWidthPath } from './segmentPath';
import { sub, dot } from '../math/vector';

const raw = JSON.parse(readFileSync(new URL('../../../../example-files/rendering bugs/not streight edge.json', import.meta.url), 'utf8'));
const cfg = normalizeProfileAnchors(JSON.parse(raw.roundabout_config)) as RoundaboutConfig;

const pathPoints = (d: string) => {
  const nums = d.match(/-?\d+\.?\d*/g)!.map(Number);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
};

const capDistance = (cap: CapLine, q: { x: number; y: number }) => Math.abs(dot(sub(q, cap.p), cap.outward));

describe('road-end caps', () => {
  it('terminates every lane strip on the same straight edge at each road end', () => {
    const segments = solveGeometry(cfg, compileRoutes(cfg, { profileEnabled: true, bypassEnabled: true }));
    const capped = segments.filter(s => s.endCap || s.startCap);
    expect(capped.length).toBeGreaterThan(0);

    // Group caps by arm + road endpoint; every lane must share one line.
    const groups = new Map<string, CapLine[]>();
    for (const s of capped) {
      const armId = s.source.kind === 'lane' ? s.source.armId : s.routeId;
      if (s.startCap) groups.set(`${armId}:start`, [...(groups.get(`${armId}:start`) ?? []), s.startCap]);
      if (s.endCap) groups.set(`${armId}:end`, [...(groups.get(`${armId}:end`) ?? []), s.endCap]);
    }
    for (const [key, caps] of groups) {
      const [first, ...rest] = caps;
      for (const cap of rest) {
        expect(capDistance(first, cap.p), `${key} cap origin`).toBeLessThan(1e-6);
        expect(Math.abs(dot(cap.outward, first.outward)), `${key} cap direction`).toBeCloseTo(1, 6);
      }
    }

    // Both corners of each capped strip end must land on the cap line when
    // the lane is present there; a zero-width taper tip starts after the cap.
    for (const s of capped) {
      const pts = pathPoints(generateVariableWidthPath(s));
      if (s.startCap && (s.widths?.[0] ?? 0) > 0) {
        expect(capDistance(s.startCap, pts[0])).toBeLessThan(1e-6);
        expect(capDistance(s.startCap, pts.at(-1)!)).toBeLessThan(1e-6);
      }
      if (s.endCap && (s.widths?.at(-1) ?? 0) > 0) {
        // The cap corners are the last left-edge vertex and the first vertex
        // of the reversed right edge; both sit on the cap line.
        const onLine = pts.filter(p => capDistance(s.endCap!, p) < 1e-6);
        expect(onLine.length, `${s.routeId} end-cap corners`).toBe(2);
      }
    }
  });
});
