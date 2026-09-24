import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { buildMarkings } from './markings';
import { generateVariableWidthPath } from './segmentPath';

const fixture = JSON.parse(readFileSync('/Users/malachyfernandez/Documents/1-programing/1-apps-and-sites/1-RoudaboutMaker/example-files/1-road is to tight turn bug/new-bad.json', 'utf8'));
const config = JSON.parse(fixture.roundabout_config) as RoundaboutConfig;

function orient(p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}
function segIntersect(a1: { x: number; y: number }, a2: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }) {
  const d1 = orient(a1, a2, b1), d2 = orient(a1, a2, b2), d3 = orient(b1, b2, a1), d4 = orient(b1, b2, a2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function selfIntersections(points: { x: number; y: number }[]): number {
  let hits = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 2; j < points.length - 1; j++) {
      if (segIntersect(points[i], points[i + 1], points[j], points[j + 1])) hits++;
    }
  }
  return hits;
}
function sharpReversal(points: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x, ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x, by = points[i + 1].y - points[i].y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-9 || lb < 1e-9) continue;
    const dot = (ax * bx + ay * by) / (la * lb);
    if (dot < -0.9) out.push(i);
  }
  return out;
}

describe('new-bad diagnostic', () => {
  it('renders scene and reports folds', () => {
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true, sampleCount: 90 }));
    const markings = buildMarkings(config, segments, { yieldSetback: 0 });
    for (const m of markings) {
      const hits = selfIntersections(m.points);
      const cusps = m.kind === 'stroke' ? sharpReversal(m.points) : [];
      if (hits || cusps.length) console.log(`[marking] ${m.kind} ${m.id} color=${m.color} selfInt=${hits} cusps=${cusps.length}`);
      for (let i = 1; i < m.points.length - 1; i++) {
        const p = m.points[i];
        if (Math.abs(p.x + 92) > 6 || Math.abs(p.y + 201) > 6) continue;
        const a = m.points[i - 1], b = m.points[i + 1];
        const u = { x: p.x - a.x, y: p.y - a.y }, v = { x: b.x - p.x, y: b.y - p.y };
        const lu = Math.hypot(u.x, u.y), lv = Math.hypot(v.x, v.y);
        if (lu < 1e-9 || lv < 1e-9) continue;
        const turn = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)))) * 180 / Math.PI;
        if (turn > 60) console.log(`[kink] ${m.kind} ${m.id} i=${i} turn=${turn.toFixed(0)}deg`);
      }
    }
    for (const seg of segments) {
      const d = generateVariableWidthPath(seg);
      if (!d) continue;
      const nums = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)!.map(Number);
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
      const hits = selfIntersections(pts);
      const cusps = sharpReversal(pts);
      if (hits || cusps.length) console.log(`[pavement] ${seg.routeId}#${seg.segIndex} ${seg.kind} selfInt=${hits} cusps=${cusps.length}`);
    }

    const toPath = (points: { x: number; y: number }[], close = false) =>
      points.length ? `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')}${close ? ' Z' : ''}` : '';
    const parts: string[] = [];
    parts.push(`<rect x="-400" y="-500" width="800" height="800" fill="#eee"/>`);
    for (const seg of segments) {
      const d = generateVariableWidthPath(seg);
      if (d) parts.push(`<path d="${d}" fill="#555" fill-rule="nonzero"/>`);
    }
    for (const m of markings) {
      if (m.kind === 'stroke') parts.push(`<path d="${toPath(m.points)}" fill="none" stroke="${m.color}" stroke-width="${m.width}" stroke-linejoin="round"/>`);
      else parts.push(`<path d="${toPath(m.points, true)}" fill="${m.color}"/>`);
    }
    writeFileSync('/tmp/newbad-full.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-220 -320 300 300" width="600" height="600">\n${parts.join('\n')}\n</svg>`);
    writeFileSync('/tmp/newbad-crop.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-125 -235 50 50" width="600" height="600">\n${parts.join('\n')}\n</svg>`);
    writeFileSync('/tmp/newbad-zoom.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -210 20 20" width="600" height="600">\n${parts.join('\n')}\n</svg>`);
  });
});
