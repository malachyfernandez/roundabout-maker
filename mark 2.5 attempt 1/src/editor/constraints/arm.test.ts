import { describe, expect, it } from 'vitest';
import { type RoundaboutConfig } from '../../config/types';
import { cross, dot } from '../../math/vector';
import { dragArmNode, insertArmNode, removeArmNode, rotateArm } from './arm';

const config: RoundaboutConfig = {
  island: { center: { x: 0, y: 0 }, radius: 15 },
  rings: [],
  arms: [{
    id: 'road',
    nodes: [
      { id: 'start', point: { x: 0, y: 0 }, tangentOut: { x: 3, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'middle', point: { x: 10, y: 0 }, tangentIn: { x: -3, y: 0 }, tangentOut: { x: 3, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] },
      { id: 'end', point: { x: 20, y: 0 }, tangentIn: { x: -3, y: 0 }, medianWidth: 4, laneWidthsIn: [10], laneWidthsOut: [10] }
    ],
    lanesIn: [],
    lanesOut: []
  }],
  circulation: 'ccw'
};

describe('arm node constraints', () => {
  it('keeps both tangent handles opposed when a middle node crosses a neighbor', () => {
    const moved = dragArmNode('road', 'middle', { x: 20, y: 0 }, config);
    const node = moved.arms[0].nodes[1];

    expect(cross(node.tangentIn!, node.tangentOut!)).toBeCloseTo(0, 10);
    expect(dot(node.tangentIn!, node.tangentOut!)).toBeLessThan(0);
  });

  it.each([
    ['first', 'start'],
    ['last', 'end']
  ])("keeps a middle node's handles opposed when the %s endpoint moves", (_label, nodeId) => {
    const moved = dragArmNode('road', nodeId, { x: 0, y: 10 }, config);
    const node = moved.arms[0].nodes[1];

    expect(cross(node.tangentIn!, node.tangentOut!)).toBeCloseTo(0, 10);
    expect(dot(node.tangentIn!, node.tangentOut!)).toBeLessThan(0);
  });

  it('restores the original curve after an inserted node is moved and deleted', () => {
    const inserted = insertArmNode(config, 'road', 0, 0.5, 'inserted');
    const moved = dragArmNode('road', 'inserted', { x: 4, y: 7 }, inserted);

    expect(removeArmNode(moved, 'road', 'inserted')).toEqual(config);
  });

  it('restores automatic handles after an inserted node is moved and deleted', () => {
    const automatic = structuredClone(config);
    delete automatic.arms[0].nodes[0].tangentOut;
    delete automatic.arms[0].nodes[1].tangentIn;
    const inserted = insertArmNode(automatic, 'road', 0, 0.5, 'inserted');
    const moved = dragArmNode('road', 'inserted', { x: 4, y: 7 }, inserted);

    expect(removeArmNode(moved, 'road', 'inserted')).toEqual(automatic);
  });
});

describe('rotateArm', () => {
  it('rotates node points and tangents around the pivot', () => {
    const rotated = rotateArm('road', { x: 0, y: 0 }, Math.PI / 2, config);
    const end = rotated.arms[0].nodes[2];

    expect(end.point.x).toBeCloseTo(0);
    expect(end.point.y).toBeCloseTo(20);
    expect(end.tangentIn!.x).toBeCloseTo(0);
    expect(end.tangentIn!.y).toBeCloseTo(-3);
  });

  it('leaves the config unchanged for an unknown arm', () => {
    expect(rotateArm('missing', { x: 0, y: 0 }, 1, config)).toEqual(config);
  });
});
