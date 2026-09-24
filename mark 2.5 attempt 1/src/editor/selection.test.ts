import { describe, expect, it, vi } from 'vitest';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { addProfilePoint, adjustProfileControls, estimateArmLength, getRoadProfile } from '../core/profile';
import { dragArmNode, dragRingCenter } from './constraints';
import { duplicateSelectionOwners } from './duplicate';
import { oneSelectionClass, repairSelections, sameSelectionTarget } from './selection';
import { deleteSelectionTargets } from './selectionMutations';
import { useEditorStore } from './editorStore';

const config = (): RoundaboutConfig => ({
  island: { center: { x: 0, y: 0 }, radius: 10 },
  rings: [{ id: 'ring', center: { x: 0, y: 0 }, radius: 30, width: 10 }],
  arms: [{
    id: 'road',
    nodes: [
      { id: 'a', point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: [10, 11], laneWidthsOut: [10] },
      { id: 'b', point: { x: 0, y: 100 }, medianWidth: 4, laneWidthsIn: [10, 11], laneWidthsOut: [10] }
    ],
    profile: [
      { id: 'p0', distance: 0, medianWidth: 4, lanesIn: [{ width: 10, gap: 0 }, { width: 11, gap: 1 }], lanesOut: [{ width: 10, gap: 0 }] },
      { id: 'p1', distance: 100, medianWidth: 4, lanesIn: [{ width: 10, gap: 0 }, { width: 11, gap: 1 }], lanesOut: [{ width: 10, gap: 0 }] }
    ],
    lanesIn: [{ filletRadius: 40 }, { filletRadius: 40 }],
    lanesOut: [{ filletRadius: 40, dropsRing: false }]
  }],
  circulation: 'ccw'
});

describe('multi-selection', () => {
  it('keeps lane nodes while selection stays in the lane and prunes neutral keys on lane exit', () => {
    const store = useEditorStore.getState();
    const previous = store.committedConfig;
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
    try {
      store.setCommittedConfig(config());
      const source = useEditorStore.getState().committedConfig;
      const arm = source.arms[0];
      expect(arm.authoredProfile).toBeDefined();
      expect(arm.profile).toBeUndefined();
      const profile = getRoadProfile(arm, estimateArmLength(arm));
      const distance = (profile[0].distance + profile.at(-1)!.distance) / 2;
      const added = addProfilePoint(source, arm.id, distance, 'out', 0);
      expect(added.pointId).not.toBeNull();
      store.setCommittedConfig(added.config);
      const node: SelectionTarget = { kind: 'lane-node', armId: arm.id, dir: 'out', laneIndex: 0, pointId: added.pointId! };
      store.setSelection(node);
      expect(useEditorStore.getState().committedConfig.arms[0].authoredProfile!.out[0].keys.some(key => key.id === added.pointId)).toBe(true);
      store.setSelection({ kind: 'lane', armId: arm.id, dir: 'out', laneIndex: 0 });
      expect(useEditorStore.getState().committedConfig.arms[0].authoredProfile!.out[0].keys.some(key => key.id === added.pointId)).toBe(true);
      store.setSelection(null);
      expect(useEditorStore.getState().committedConfig.arms[0].authoredProfile!.out[0].keys.some(key => key.id === added.pointId)).toBe(false);
    } finally {
      useEditorStore.setState({ committedConfig: previous, selection: null, selections: [] });
      vi.unstubAllGlobals();
    }
  });
  it('compares targets by identity and repairs missing children to their road', () => {
    expect(sameSelectionTarget({ kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }, { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 })).toBe(true);
    expect(repairSelections(config(), [{ kind: 'arm-node', armId: 'road', nodeId: 'missing' }])).toEqual([{ kind: 'arm', armId: 'road' }]);
  });

  it('repairs a removed lane node to its owning lane instead of closing lane edit mode', () => {
    expect(repairSelections(config(), [{ kind: 'lane-node', armId: 'road', pointId: 'missing', dir: 'in', laneIndex: 1 }])).toEqual([
      { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 1 }
    ]);
  });

  it('keeps lane segments as first-class targets and repairs missing endpoints to their lane', () => {
    const segment: SelectionTarget = { kind: 'lane-segment', armId: 'road', fromPointId: 'p0', toPointId: 'p1', dir: 'in', laneIndex: 0 };
    expect(repairSelections(config(), [segment])).toEqual([segment]);
    expect(repairSelections(config(), [{ ...segment, toPointId: 'missing' }])).toEqual([
      { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 }
    ]);
  });

  it('replaces the selection when an additive target has a different classification', () => {
    const arm: SelectionTarget = { kind: 'arm', armId: 'road' };
    const firstNode: SelectionTarget = { kind: 'arm-node', armId: 'road', nodeId: 'a' };
    const secondNode: SelectionTarget = { kind: 'arm-node', armId: 'road', nodeId: 'b' };
    expect(oneSelectionClass([arm, firstNode], firstNode)).toEqual([firstNode]);
    useEditorStore.getState().setSelection(arm);
    useEditorStore.getState().selectTarget(firstNode, true);
    expect(useEditorStore.getState().selections).toEqual([firstNode]);
    useEditorStore.getState().selectTarget(secondNode, true);
    expect(useEditorStore.getState().selections).toEqual([firstNode, secondNode]);
    useEditorStore.getState().setSelection(null);
  });

  it('duplicates each selected structural owner once and remaps child selections', () => {
    const selections: SelectionTarget[] = [
      { kind: 'arm-node', armId: 'road', nodeId: 'a' },
      { kind: 'profile-control', armId: 'road', pointId: 'p0', dir: 'in', control: 'width', laneIndex: 0 },
      { kind: 'ring', ringId: 'ring' }
    ];
    const duplicated = duplicateSelectionOwners(config(), selections);
    expect(duplicated.config.arms).toHaveLength(2);
    expect(duplicated.config.rings).toHaveLength(2);
    expect(new Set(duplicated.selections.filter(target => 'armId' in target).map(target => target.armId)).size).toBe(1);
    expect(duplicated.selections.every(target => target.kind === 'ring' ? target.ringId !== 'ring' : !('armId' in target) || target.armId !== 'road')).toBe(true);
  });

  it('applies a common delta only to explicitly grouped profile controls', () => {
    const next = adjustProfileControls(config(), [
      { kind: 'profile-control', armId: 'road', pointId: 'p0', dir: 'in', control: 'width', laneIndex: 0 },
      { kind: 'profile-control', armId: 'road', pointId: 'p1', dir: 'in', control: 'width', laneIndex: 1 }
    ], 2);
    expect(next.arms[0].profile?.[0].lanesIn[0].width).toBe(12);
    expect(next.arms[0].profile?.[0].lanesIn[1].width).toBe(11);
    expect(next.arms[0].profile?.[1].lanesIn[1].width).toBe(13);
  });

  it('deletes grouped lanes from highest index first', () => {
    const next = deleteSelectionTargets(config(), [
      { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 0 },
      { kind: 'lane', armId: 'road', dir: 'in', laneIndex: 1 }
    ]);
    expect(next.arms[0].lanesIn).toHaveLength(0);
    expect(next.arms[0].profile?.[0].lanesIn).toHaveLength(0);
  });

  it('uses precise coordinates when snapping is disabled', () => {
    expect(dragArmNode('road', 'a', { x: 1.25, y: 2.75 }, config(), false).arms[0].nodes[0].point).toEqual({ x: 1.25, y: 2.75 });
    expect(dragRingCenter('ring', { x: 1.25, y: 2.75 }, config(), false).rings[0].center).toEqual({ x: 1.25, y: 2.75 });
  });
});
