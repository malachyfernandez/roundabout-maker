import { type ArmNode, type RoundaboutConfig } from '../config/types';
import { type Vec2, add, angleOf, dot, len, lerp, norm, rot, scale, sub } from '../math/vector';
import { getBezierSegment } from '../math/spline';
import { solveLaneRingAttachmentPoint } from '../core/routes';

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

export function dragLaneFilletRadius(armId: string, dir: 'in' | 'out', laneIndex: number, centerRate: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  const source = original.arms.find(candidate => candidate.id === armId);
  if (!arm || !source) return next;
  const lanes = dir === 'in' ? arm.lanesIn : arm.lanesOut;
  const sourceLanes = dir === 'in' ? source.lanesIn : source.lanesOut;
  if (!lanes[laneIndex] || !sourceLanes[laneIndex]) return next;
  const radius = sourceLanes[laneIndex].filletRadius ?? 15;
  const rateSquared = dot(centerRate, centerRate);
  const radiusDelta = rateSquared > 1e-9 ? dot(delta, centerRate) / rateSquared : 0;
  lanes[laneIndex].filletRadius = Math.max(5, Math.round((radius + radiusDelta) * 10) / 10);
  return next;
}

export function dragBypassConnectorRadius(bypassId: string, connector: 'entry' | 'exit', centerRate: Vec2, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  const rateSquared = dot(centerRate, centerRate);
  const radiusDelta = rateSquared > 1e-9 ? dot(delta, centerRate) / rateSquared : 0;
  const sourceRadius = connector === 'entry' ? source.entryRadius ?? source.radius ?? 32 : source.exitRadius ?? source.radius ?? 32;
  const radius = Math.max(2, Math.min(200, Math.round((sourceRadius + radiusDelta) * 10) / 10));
  if (connector === 'entry') bypass.entryRadius = radius;
  else bypass.exitRadius = radius;
  return next;
}

export function dragBypassLanePoint(bypassId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  // Restrict movement to the radial direction (toward/away from the
  // outermost ring center). This conserves space and keeps the bypass
  // lane near the roundabout edge.
  const outerRing = original.rings.reduce((outer, ring) =>
    !outer || ring.radius + ring.width / 2 > outer.radius + outer.width / 2 ? ring : outer
  , original.rings[0]);
  const center = outerRing?.center ?? { x: 0, y: 0 };
  const radial = sub(source.lanePoint, center);
  const radialLen = len(radial);
  const radialDir = radialLen > 1e-9 ? scale(radial, 1 / radialLen) : { x: 1, y: 0 };
  const radialDelta = dot(delta, radialDir);
  const newRadial = radialLen + radialDelta;
  bypass.lanePoint = {
    x: Math.round((center.x + radialDir.x * newRadial) * 10) / 10,
    y: Math.round((center.y + radialDir.y * newRadial) * 10) / 10
  };
  return next;
}

export function dragBypassLaneAngle(bypassId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const bypass = next.bypasses?.find(candidate => candidate.id === bypassId);
  const source = original.bypasses?.find(candidate => candidate.id === bypassId);
  if (!bypass || !source) return next;
  // Compute the angle change from the drag delta projected onto the
  // perpendicular of the original lane direction. The rotation handle
  // sits 30 units along the lane direction from the placement point.
  const originalDir = { x: Math.cos(source.laneAngle), y: Math.sin(source.laneAngle) };
  const perp = { x: -originalDir.y, y: originalDir.x };
  const angularDelta = dot(delta, perp) / 30;
  bypass.laneAngle = source.laneAngle + angularDelta;
  return next;
}

export type LaneRingSnapPoint = { ringId: string; point: Vec2 };

export function getLaneRingSnapPoints(config: RoundaboutConfig, armId: string, dir: 'in' | 'out', laneIndex: number): LaneRingSnapPoint[] {
  return config.rings.map(ring => {
    const point = solveLaneRingAttachmentPoint(config, armId, dir, laneIndex, ring.id);
    if (point) return { ringId: ring.id, point };

    const arm = config.arms.find(candidate => candidate.id === armId);
    const nearNode = arm?.nodes[0];
    if (!nearNode) return null;
    const radial = sub(nearNode.point, ring.center);
    const distance = len(radial);
    const fallback = distance > 0
      ? add(ring.center, scale(radial, ring.radius / distance))
      : { x: ring.center.x + ring.radius, y: ring.center.y };
    return { ringId: ring.id, point: fallback };
  }).filter((point): point is LaneRingSnapPoint => point !== null);
}

export function assignLaneRingTarget(armId: string, dir: 'in' | 'out', laneIndex: number, ringId: string, original: RoundaboutConfig): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  if (dir === 'in') {
    if (!arm.lanesIn[laneIndex]) return next;
    arm.lanesIn[laneIndex].targetsRing = ringId;
    next.bypasses = next.bypasses?.filter(bypass => bypass.fromArmId !== armId || bypass.fromLaneIndex !== laneIndex);
  } else {
    if (!arm.lanesOut[laneIndex]) return next;
    arm.lanesOut[laneIndex].sourceRing = ringId;
    next.bypasses = next.bypasses?.filter(bypass => bypass.toArmId !== armId || bypass.toLaneIndex !== laneIndex);
  }
  return next;
}

export function dragArmNode(armId: string, nodeId: string, delta: Vec2, original: RoundaboutConfig): RoundaboutConfig {
  const next = JSON.parse(JSON.stringify(original)) as RoundaboutConfig;
  const arm = next.arms.find(a => a.id === armId);
  if (!arm) return next;
  const index = arm.nodes.findIndex(n => n.id === nodeId);
  if (index < 0) return next;
  const node = arm.nodes[index];
  const oldPoint = { x: node.point.x, y: node.point.y };
  node.point = {
    x: Math.round(node.point.x + delta.x),
    y: Math.round(node.point.y + delta.y)
  };

  // Rotate explicit tangents to preserve their angle relative to the
  // node-to-neighbor direction. This keeps straight roads straight when
  // dragging end nodes, and preserves curve shapes on curved roads.
  const rotateTangent = (tangent: Vec2 | undefined, oldDir: Vec2, newDir: Vec2): Vec2 | undefined => {
    if (!tangent) return undefined;
    const tangentLen = len(tangent);
    if (tangentLen < 1e-9) return tangent;
    const rotation = angleOf(newDir) - angleOf(oldDir);
    return rot(tangent, rotation);
  };

  if (index > 0) {
    const prev = arm.nodes[index - 1];
    // This node's tangentIn points toward the previous node
    node.tangentIn = rotateTangent(node.tangentIn, sub(prev.point, oldPoint), sub(prev.point, node.point));
    // Previous node's tangentOut points toward this node
    prev.tangentOut = rotateTangent(prev.tangentOut, sub(oldPoint, prev.point), sub(node.point, prev.point));
  }
  if (index < arm.nodes.length - 1) {
    const nextNode = arm.nodes[index + 1];
    // This node's tangentOut points toward the next node
    node.tangentOut = rotateTangent(node.tangentOut, sub(nextNode.point, oldPoint), sub(nextNode.point, node.point));
    // Next node's tangentIn points toward this node
    nextNode.tangentIn = rotateTangent(nextNode.tangentIn, sub(oldPoint, nextNode.point), sub(node.point, nextNode.point));
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

export function swapArmDirection(original: RoundaboutConfig, armId: string): RoundaboutConfig {
  const next = structuredClone(original);
  const arm = next.arms.find(candidate => candidate.id === armId);
  if (!arm) return next;
  arm.nodes.reverse();
  // Swap tangent directions for each node since the road now runs the other way.
  for (const node of arm.nodes) {
    const tangentIn = node.tangentIn;
    node.tangentIn = node.tangentOut;
    node.tangentOut = tangentIn;
    // Swap lane widths since in/out are relative to direction.
    const laneWidthsIn = node.laneWidthsIn;
    node.laneWidthsIn = node.laneWidthsOut;
    node.laneWidthsOut = laneWidthsIn;
  }
  // Swap lanesIn and lanesOut arrays (they reference rings from opposite perspectives).
  const lanesIn = arm.lanesIn;
  arm.lanesIn = arm.lanesOut.map(lane => ({ targetsRing: lane.sourceRing, filletRadius: lane.filletRadius }));
  arm.lanesOut = lanesIn.map(lane => ({ sourceRing: lane.targetsRing, filletRadius: lane.filletRadius, dropsRing: false }));
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
