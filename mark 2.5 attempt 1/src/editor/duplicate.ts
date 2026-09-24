import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { selectionKey } from './selection';

const uniqueId = (base: string, used: Set<string>) => {
  let index = 2;
  let candidate = `${base}_copy`;
  while (used.has(candidate)) candidate = `${base}_copy_${index++}`;
  used.add(candidate);
  return candidate;
};

export function duplicateSelectionOwners(original: RoundaboutConfig, selections: SelectionTarget[]) {
  const config = structuredClone(original);
  const ringIds = new Set(selections.filter((target): target is Extract<SelectionTarget, { kind: 'ring' }> => target.kind === 'ring').map(target => target.ringId));
  const armIds = new Set(selections.filter(target => 'armId' in target).map(target => target.armId));
  const ringMap = new Map<string, string>();
  const armMap = new Map<string, string>();
  const nodeMaps = new Map<string, Map<string, string>>();
  const pointMaps = new Map<string, Map<string, string>>();
  const usedRingIds = new Set(config.rings.map(ring => ring.id));
  const usedArmIds = new Set(config.arms.map(arm => arm.id));

  for (const ringId of ringIds) {
    const source = original.rings.find(ring => ring.id === ringId);
    if (!source) continue;
    const id = uniqueId(source.id, usedRingIds);
    ringMap.set(ringId, id);
    config.rings.push({ ...structuredClone(source), id });
  }

  for (const armId of armIds) {
    const source = original.arms.find(arm => arm.id === armId);
    if (!source) continue;
    const copy = structuredClone(source);
    const id = uniqueId(source.id, usedArmIds);
    const nodeMap = new Map<string, string>();
    const pointMap = new Map<string, string>();
    copy.id = id;
    for (const node of copy.nodes) {
      const nextId = `${id}_${node.id}`;
      nodeMap.set(node.id, nextId);
      node.id = nextId;
      delete node.splitRestore;
    }
    if (copy.authoredProfile) {
      for (const key of copy.authoredProfile.median) {
        const nextId = `${id}_${key.id}`;
        pointMap.set(key.id, nextId);
        key.id = nextId;
      }
      for (const dir of ['in', 'out'] as const) for (const lane of copy.authoredProfile[dir]) {
        for (const key of lane.keys) {
          const nextId = `${id}_${key.id}`;
          pointMap.set(key.id, nextId);
          key.id = nextId;
        }
        for (const span of lane.spans) {
          for (const side of ['low', 'high'] as const) {
            pointMap.set(`${span.id}_${side}_attach`, `${id}_${span.id}_${side}_attach`);
            pointMap.set(`${span.id}_${side}_tip`, `${id}_${span.id}_${side}_tip`);
          }
          span.id = `${id}_${span.id}`;
        }
      }
    } else if (copy.profile?.length) {
      for (const point of copy.profile) {
        const nextId = `${id}_${point.id}`;
        pointMap.set(point.id, nextId);
        point.id = nextId;
      }
    } else {
      source.nodes.forEach((_, index) => pointMap.set(`${source.id}_profile_${index}`, `${id}_profile_${index}`));
    }
    armMap.set(armId, id);
    nodeMaps.set(armId, nodeMap);
    pointMaps.set(armId, pointMap);
    config.arms.push(copy);
  }

  const remap = (target: SelectionTarget): SelectionTarget => {
    if (target.kind === 'island') return target;
    if (target.kind === 'ring') return { ...target, ringId: ringMap.get(target.ringId) ?? target.ringId };
    const armId = armMap.get(target.armId) ?? target.armId;
    if (target.kind === 'arm-node') return { ...target, armId, nodeId: nodeMaps.get(target.armId)?.get(target.nodeId) ?? target.nodeId };
    if (target.kind === 'profile-point' || target.kind === 'profile-control' || target.kind === 'lane-node') return { ...target, armId, pointId: pointMaps.get(target.armId)?.get(target.pointId) ?? target.pointId };
    if (target.kind === 'lane-segment') {
      const pointMap = pointMaps.get(target.armId);
      return { ...target, armId, fromPointId: pointMap?.get(target.fromPointId) ?? target.fromPointId, toPointId: pointMap?.get(target.toPointId) ?? target.toPointId };
    }
    return { ...target, armId };
  };
  const mappedSelections = selections.filter(target => target.kind !== 'island').map(remap);
  const targetMap = new Map(selections.map(target => [selectionKey(target), remap(target)]));
  return { config, selections: mappedSelections, targetMap };
}
