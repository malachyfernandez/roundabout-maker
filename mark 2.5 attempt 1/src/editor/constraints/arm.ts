import { type ArmNode, type RoundaboutConfig } from '../../config/types';
import { type Vec2, add, angleOf, len, lerp, norm, rot, scale, sub } from '../../math/vector';
import { getBezierSegment } from '../../math/spline';

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
  arm.lanesIn = arm.lanesOut.map(lane => ({ sourceRing: lane.sourceRing, targetsRing: lane.targetsRing, filletRadius: lane.filletRadius, sourceFilletRadius: lane.sourceFilletRadius, targetFilletRadius: lane.targetFilletRadius, dropsRing: lane.dropsRing }));
  arm.lanesOut = lanesIn.map(lane => ({ sourceRing: lane.sourceRing, targetsRing: lane.targetsRing, filletRadius: lane.filletRadius, sourceFilletRadius: lane.sourceFilletRadius, targetFilletRadius: lane.targetFilletRadius, dropsRing: lane.dropsRing ?? false }));
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
