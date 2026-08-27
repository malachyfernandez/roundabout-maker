import { type RoundaboutConfig } from '../../config/types';
import { type Vec2, dot } from '../../math/vector';

export function dragIslandCenter(delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const cx = original.island.center?.x || 0;
  const cy = original.island.center?.y || 0;
  next.island.center = {
    x: Math.round(cx + delta.x),
    y: Math.round(cy + delta.y)
  };
  return next;
}

export function dragIslandRadius(direction: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  next.island.radius = Math.max(5, Math.round((original.island.radius + dot(delta, direction)) * 10) / 10);
  return next;
}

export function dragRingCenter(ringId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) ring.center = { x: Math.round(source.center.x + delta.x), y: Math.round(source.center.y + delta.y) };
  return next;
}

export function dragRingRadius(ringId: string, direction: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) ring.radius = Math.max(5, Math.round((source.radius + dot(delta, direction)) * 10) / 10);
  return next;
}

export function dragRingWidth(ringId: string, direction: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) ring.width = Math.max(2, Math.round((source.width + dot(delta, direction) * 2) * 10) / 10);
  return next;
}
