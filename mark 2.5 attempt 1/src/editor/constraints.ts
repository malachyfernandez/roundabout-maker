import { type ArmNode, type RoundaboutConfig } from '../config/types';
import { type Vec2, add, dot, len, lerp, norm, scale, sub } from '../math/vector';
import { getBezierSegment } from '../math/spline';

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

export function dragLaneFilletRadius(armId: string, dir: 'in' | 'out', laneIndex: number, direction: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  const source = original.arms.find(candidate => candidate.id === armId);
  if (!arm || !source) return next;
  const lanes = dir === 'in' ? arm.lanesIn : arm.lanesOut;
  const sourceLanes = dir === 'in' ? source.lanesIn : source.lanesOut;
  if (!lanes[laneIndex] || !sourceLanes[laneIndex]) return next;
  const radius = sourceLanes[laneIndex].filletRadius ?? 15;
  lanes[laneIndex].filletRadius = Math.max(5, Math.round((radius + dot(delta, direction)) * 10) / 10);
  return next;
}

export function dragBypassRadius(bypassId: string, direction: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (bypass && source) bypass.radius = Math.max(8, Math.round((source.radius + dot(delta, direction)) * 10) / 10);
  return next;
}

export function dragLaneRingTarget(armId: string, dir: 'in' | 'out', laneIndex: number, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  const sourceArm = original.arms.find(candidate => candidate.id === armId);
  if (!arm || !sourceArm || next.rings.length === 0) return next;
  const sourceRingId = dir === 'in' ? sourceArm.lanesIn[laneIndex]?.targetsRing : sourceArm.lanesOut[laneIndex]?.sourceRing;
  if (!sourceRingId) return next;
  const sourceCenter = original.rings.find(ring => ring.id === sourceRingId)?.center ?? original.rings[0].center;
  const pointer = add(sourceCenter, delta);
  const nearest = next.rings.reduce((best, ring) => len(sub(ring.center, pointer)) < len(sub(best.center, pointer)) ? ring : best);
  if (dir === 'in') {
    if (arm.lanesIn[laneIndex]) arm.lanesIn[laneIndex].targetsRing = nearest.id;
  } else if (arm.lanesOut[laneIndex]) {
    arm.lanesOut[laneIndex].sourceRing = nearest.id;
  }
  return next;
}

export function dragArmNode(armId: string, nodeId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const arm = next.arms.find(a => a.id === armId);
  if (arm) {
    const node = arm.nodes.find(n => n.id === nodeId);
    if (node) {
      node.point = {
        x: Math.round(node.point.x + delta.x),
        y: Math.round(node.point.y + delta.y)
      };
    }
  }
  return next;
}

function currentHandle(nodes: ArmNode[], index: number, which: 'in' | 'out'): Vec2 {
  const node = nodes[index];
  if (which === 'out') {
    if (node.tangentOut) return node.tangentOut;
    const segment = getBezierSegment(nodes, Math.min(index, nodes.length - 2));
    return sub(segment.c1, node.point);
  }
  if (node.tangentIn) return node.tangentIn;
  const segment = getBezierSegment(nodes, Math.max(0, index - 1));
  return sub(segment.c2, node.point);
}

export function dragTangentHandle(armId: string, nodeId: string, which: 'in' | 'out', delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const originalArm = original.arms.find(a => a.id === armId);
  const arm = next.arms.find(a => a.id === armId);
  if (!originalArm || !arm) return next;
  const index = arm.nodes.findIndex(n => n.id === nodeId);
  if (index < 0) return next;
  const moved = add(currentHandle(originalArm.nodes, index, which), delta);
  const opposite = which === 'in' ? 'out' : 'in';
  arm.nodes[index][which === 'in' ? 'tangentIn' : 'tangentOut'] = moved;
  const hasOpposite = opposite === 'in' ? index > 0 : index < arm.nodes.length - 1;
  if (hasOpposite) {
    const oppositeLength = len(currentHandle(originalArm.nodes, index, opposite));
    arm.nodes[index][opposite === 'in' ? 'tangentIn' : 'tangentOut'] = scale(norm(moved), -oppositeLength);
  }
  return next;
}

export function removeArmNode(original: RoundaboutConfig, armId: string, nodeId: string): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm || arm.nodes.length <= 2) return next;
  const index = arm.nodes.findIndex(node => node.id === nodeId);
  if (index < 0) return next;
  arm.nodes.splice(index, 1);
  if (arm.nodes[index - 1]) delete arm.nodes[index - 1].tangentOut;
  if (arm.nodes[index]) delete arm.nodes[index].tangentIn;
  return next;
}

export function insertArmNode(original: RoundaboutConfig, armId: string, segmentIndex: number, t: number, nodeId: string): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const arm = next.arms.find(a => a.id === armId);
  if (!arm || segmentIndex < 0 || segmentIndex >= arm.nodes.length - 1) return next;
  const segment = getBezierSegment(arm.nodes, segmentIndex);
  const q0 = lerp(segment.p0, segment.c1, t);
  const q1 = lerp(segment.c1, segment.c2, t);
  const q2 = lerp(segment.c2, segment.p1, t);
  const r0 = lerp(q0, q1, t);
  const r1 = lerp(q1, q2, t);
  const point = lerp(r0, r1, t);
  const start = arm.nodes[segmentIndex];
  const end = arm.nodes[segmentIndex + 1];
  const interpolateWidths = (a: number[], b: number[]) => a.map((value, index) => value + ((b[index] ?? value) - value) * t);
  const node: ArmNode = {
    id: nodeId,
    point,
    tangentIn: sub(r0, point),
    tangentOut: sub(r1, point),
    medianWidth: start.medianWidth + (end.medianWidth - start.medianWidth) * t,
    laneWidthsIn: interpolateWidths(start.laneWidthsIn, end.laneWidthsIn),
    laneWidthsOut: interpolateWidths(start.laneWidthsOut, end.laneWidthsOut)
  };
  start.tangentOut = sub(q0, start.point);
  end.tangentIn = sub(q2, end.point);
  arm.nodes.splice(segmentIndex + 1, 0, node);
  return next;
}
