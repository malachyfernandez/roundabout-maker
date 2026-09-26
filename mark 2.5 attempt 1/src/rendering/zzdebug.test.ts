import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type RoundaboutConfig } from '../config/types';
import { compileRoutes } from '../core/routes';
import { solveGeometry } from '../core/solver';
import { normalizeProfileAnchors } from '../core/profile/anchors';
import { buildMarkings } from './markings';
import { generateSegmentSurface } from './segmentPath';

const EXPORT_PATH = fileURLToPath(new URL('../../../../example-files/roundabout marking bug/roundabout-export(1).json', import.meta.url));
const OUT_PATH = '/tmp/roundabout-debug.svg';
const OUT_PATH2 = '/tmp/roundabout-debug-markings.svg';

describe('debug export', () => {
  it('dumps svg', () => {
    const raw = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'));
    const settings = JSON.parse(raw.roundabout_settings);
    const config = normalizeProfileAnchors(JSON.parse(raw.roundabout_config)) as RoundaboutConfig;
    const segments = solveGeometry(config, compileRoutes(config, { profileEnabled: true, bypassEnabled: true }));
    const markings = buildMarkings(config, segments, {
      ringLaneCollisionBuffer: settings.ringLaneCollisionBuffer,
      yieldSetback: settings.yieldSetback
    });

    const surfacePaths = segments.map(s => `<path d="${generateSegmentSurface(s).d}" fill="#4a4a4a" stroke="none"/>`).join('\n');
    const markingPaths = markings.map(m => m.kind === 'fill'
      ? `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')} Z" fill="${m.color}" stroke="none"/>`
      : `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')}" fill="none" stroke="${m.color}" stroke-width="${m.width}" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''} ${m.dashOffset ? `stroke-dashoffset="${m.dashOffset}"` : ''}/>`
    ).join('\n');
    const palette = ['#ff00ff', '#00ffff', '#ff8800', '#00ff00', '#ff0088', '#8800ff', '#ffff00', '#ff0000'];
    const coded = markings.map((m, i) => {
      const color = palette[i % palette.length];
      return m.kind === 'fill'
        ? `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')} Z" fill="${color}" fill-opacity="0.5" stroke="none"/>`
        : `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
    }).join('\n');
    markings.forEach((m, i) => {
      const near = m.points.some(p => p.x > -5 && p.x < 95 && p.y > -80 && p.y < 5);
      if (near) {
        const xs = m.points.map(p => p.x), ys = m.points.map(p => p.y);
        console.log(`${palette[i % palette.length]} ${m.id} bbox=[${Math.min(...xs).toFixed(1)},${Math.min(...ys).toFixed(1)} → ${Math.max(...xs).toFixed(1)},${Math.max(...ys).toFixed(1)}] first=${JSON.stringify(m.points[0])} last=${JSON.stringify(m.points.at(-1))}`);
      }
    });
    writeFileSync('/tmp/roundabout-debug-coded.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -75 90 75"><rect x="0" y="-75" width="90" height="75" fill="#888"/>\n${surfacePaths}\n${coded}\n</svg>`);
    const vb = '-10.53 -70.68 97.1 97.1';
    const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><rect x="-10.53" y="-70.68" width="97.1" height="97.1" fill="#888"/>\n${inner}\n</svg>`;
    writeFileSync(OUT_PATH, svg(`${surfacePaths}\n${markingPaths}`));
    writeFileSync(OUT_PATH2, svg(markingPaths));
    const group = (pred: (m: typeof markings[number]) => boolean) => markings.filter(pred).map(m => m.kind === 'fill'
      ? `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')} Z" fill="${m.color}" stroke="none"/>`
      : `<path d="M ${m.points.map(p => `${p.x} ${p.y}`).join(' L ')}" fill="none" stroke="${m.color}" stroke-width="${m.width}" ${m.dash ? `stroke-dasharray="${m.dash}"` : ''}/>`
    ).join('\n');
    writeFileSync('/tmp/dbg-pavement.svg', svg(surfacePaths));
    writeFileSync('/tmp/dbg-fillets.svg', svg(`${surfacePaths}\n${group(m => m.id.includes('_curve_'))}`));
    writeFileSync('/tmp/dbg-lines.svg', svg(`${surfacePaths}\n${group(m => m.id.includes('_edge') || m.id.includes('_median') || m.id.includes('_divider'))}`));
    writeFileSync('/tmp/dbg-rings.svg', svg(`${surfacePaths}\n${group(m => m.id.includes('_outer_') || m.id.includes('_inner_') || m.id.startsWith('central_'))}`));

    // Analysis: report markings whose points sit inside ring pavement
    const ringClear = (p: { x: number; y: number }) => config.rings.reduce((c, ring) => {
      const d = Math.hypot(p.x - ring.center.x, p.y - ring.center.y);
      const ri = Math.max(0, ring.radius - ring.width / 2);
      const ro = ring.radius + ring.width / 2;
      return Math.min(c, Math.max(d - ro, ri - d));
    }, Infinity);
    for (const m of markings) {
      if (m.kind !== 'stroke') continue;
      const bad = m.points.filter(p => ringClear(p) < -0.2);
      if (bad.length) {
        console.log(`MARKING IN RING: ${m.id} color=${m.color} dash=${m.dash} pts=${m.points.length} bad=${bad.length}`);
        console.log('  first bad:', JSON.stringify(bad[0]), 'last bad:', JSON.stringify(bad.at(-1)));
      }
    }
    // list all markings near the north arm junction
    for (const m of markings) {
      const near = m.points.filter(p => p.y < -30 && p.y > -80 && Math.abs(p.x) < 50);
      if (near.length > 0) console.log('NEAR JUNCTION:', m.id, m.kind, m.color, m.dash ?? '', 'npts', m.points.length);
    }
  });
});
