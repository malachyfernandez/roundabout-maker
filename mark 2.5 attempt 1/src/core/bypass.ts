import { type ArmConfig } from '../config/types';
import { cross, norm, scale, sub } from '../math/vector';

function outwardDirection(arm: ArmConfig) {
  if (arm.nodes.length < 2) return { x: 0, y: 0 };
  return norm(sub(arm.nodes[arm.nodes.length - 1].point, arm.nodes[0].point));
}

export function isRightTurnPair(source: ArmConfig | undefined, target: ArmConfig | undefined) {
  if (!source || !target || source.id === target.id) return false;
  const incoming = scale(outwardDirection(source), -1);
  const outgoing = outwardDirection(target);
  return cross(incoming, outgoing) > 0.25;
}
