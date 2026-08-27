import { type ArmConfig, type RoundaboutConfig } from '../config/types';
import { sampleSpline, type CatmullRomSpline } from '../math/spline';
import { add, dot, len, norm, perpLeft, scale, sub, type Vec2 } from '../math/vector';
import { type ProfileDirection } from './editorMath';

export type ProfileGeometry = { samples: { p: Vec2; tangent: Vec2; normal: Vec2; distance: number }[]; totalLength: number };

const makeSpline = (arm: ArmConfig): CatmullRomSpline => ({ points: arm.nodes.map(node => node.point), nodes: arm.nodes, alpha: 0.5, tension: 0 });

export function profileGeometry(arm: ArmConfig): ProfileGeometry {
  const raw = sampleSpline(makeSpline(arm), Math.max(120, arm.nodes.length * 60));
  let distance = 0;
  const samples = raw.map((sample, index) => {
    if (index) distance += len(sub(sample.p, raw[index - 1].p));
    return { ...sample, tangent: norm(sample.tangent), normal: norm(perpLeft(sample.tangent)), distance };
  });
  return { samples, totalLength: distance };
}

export function atProfileDistance(geometry: ProfileGeometry, distance: number) {
  const target = Math.max(0, Math.min(geometry.totalLength, distance));
  const upper = geometry.samples.findIndex(sample => sample.distance >= target);
  if (upper <= 0) return geometry.samples[0];
  const a = geometry.samples[upper - 1];
  const b = geometry.samples[upper];
  const t = (target - a.distance) / Math.max(1e-6, b.distance - a.distance);
  const tangent = norm(add(scale(a.tangent, 1 - t), scale(b.tangent, t)));
  return { p: add(scale(a.p, 1 - t), scale(b.p, t)), tangent, normal: norm(perpLeft(tangent)), distance: target };
}

export function projectProfileDistance(geometry: ProfileGeometry, point: Vec2) {
  let bestDistance = 0;
  let bestGap = Infinity;
  for (let index = 1; index < geometry.samples.length; index++) {
    const a = geometry.samples[index - 1];
    const b = geometry.samples[index];
    const edge = sub(b.p, a.p);
    const lengthSquared = dot(edge, edge);
    const t = lengthSquared ? Math.max(0, Math.min(1, dot(sub(point, a.p), edge) / lengthSquared)) : 0;
    const projected = add(a.p, scale(edge, t));
    const gap = len(sub(point, projected));
    if (gap < bestGap) {
      bestGap = gap;
      bestDistance = a.distance + (b.distance - a.distance) * t;
    }
  }
  return bestDistance;
}

export function profileDirectionSign(config: RoundaboutConfig, dir: ProfileDirection) {
  const isRhd = config.circulation === 'ccw';
  return isRhd ? (dir === 'in' ? 1 : -1) : (dir === 'in' ? -1 : 1);
}

export function profilePointsPath(points: Vec2[]) {
  return points.length ? `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}` : '';
}

export function profilePointerTransform(center: Vec2, travel: Vec2, sideNormal: Vec2, zoom: number, anchorX: number, anchorY: number, flipY = false) {
  const size = 1.6 * zoom;
  const a = -travel.x * size;
  const b = -travel.y * size;
  const c = (flipY ? -1 : 1) * sideNormal.x * size;
  const d = (flipY ? -1 : 1) * sideNormal.y * size;
  return `matrix(${a} ${b} ${c} ${d} ${center.x - a * anchorX - c * anchorY} ${center.y - b * anchorX - d * anchorY})`;
}
