import { type RoundaboutConfig } from '../../config/types';
import { type Vec2, dot } from '../../math/vector';

export function dragIslandCenter(delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const cx = original.island.center?.x || 0;
  const cy = original.island.center?.y || 0;
  next.island.center = {
    x: snap ? Math.round(cx + delta.x) : cx + delta.x,
    y: snap ? Math.round(cy + delta.y) : cy + delta.y
  };
  return next;
}

export function dragIslandRadius(direction: Vec2, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  const next = structuredClone(original);
  const value = original.island.radius + dot(delta, direction);
  next.island.radius = Math.max(5, snap ? Math.round(value * 10) / 10 : value);
  return next;
}

export function dragRingCenter(ringId: string, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) ring.center = {
    x: snap ? Math.round(source.center.x + delta.x) : source.center.x + delta.x,
    y: snap ? Math.round(source.center.y + delta.y) : source.center.y + delta.y
  };
  return next;
}

export function dragRingCenters(ringIds: string[], delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  return ringIds.reduce((next, ringId) => dragRingCenter(ringId, delta, next, snap), original);
}

export function dragRingRadius(ringId: string, direction: Vec2, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) {
    const value = source.radius + dot(delta, direction);
    ring.radius = Math.max(5, snap ? Math.round(value * 10) / 10 : value);
  }
  return next;
}

export function dragRingRadii(ringIds: string[], direction: Vec2, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  return ringIds.reduce((next, ringId) => dragRingRadius(ringId, direction, delta, next, snap), original);
}

export function dragRingWidth(ringId: string, direction: Vec2, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  const next = structuredClone(original);
  const ring = next.rings.find(candidate => candidate.id === ringId);
  const source = original.rings.find(candidate => candidate.id === ringId);
  if (ring && source) {
    const value = source.width + dot(delta, direction) * 2;
    ring.width = Math.max(2, snap ? Math.round(value * 10) / 10 : value);
  }
  return next;
}

export function dragRingWidths(ringIds: string[], direction: Vec2, delta: Vec2, original: RoundaboutConfig, snap = true): RoundaboutConfig {
  return ringIds.reduce((next, ringId) => dragRingWidth(ringId, direction, delta, next, snap), original);
}
