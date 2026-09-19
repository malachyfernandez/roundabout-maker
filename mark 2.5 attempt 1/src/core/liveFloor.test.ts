import { describe, expect, it } from 'vitest';
import { numericFloorLift, resolveLiveFloor, resolveNumericFloor } from './liveFloor';

describe('live floor resolution', () => {
  it('returns the requested value when no floor applies', () => {
    const result = resolveNumericFloor(10);
    expect(result.resolved).toBe(10);
    expect(result.floored).toBe(false);
  });

  it('returns the requested value when it is above the floor', () => {
    const result = resolveNumericFloor(10, 4);
    expect(result.resolved).toBe(10);
    expect(result.floored).toBe(false);
  });

  it('lifts the resolved value to the floor when requested is below it', () => {
    const result = resolveNumericFloor(4, 10);
    expect(result.resolved).toBe(10);
    expect(result.floored).toBe(true);
    expect(result.requested).toBe(4);
    expect(result.floor).toBe(10);
  });

  it('releases back to the requested value when the floor drops', () => {
    // Same requested value, two different geometry states.
    expect(resolveNumericFloor(30, 60).resolved).toBe(60);
    expect(resolveNumericFloor(30, 20).resolved).toBe(30);
  });

  it('supports non-scalar values through a custom lift', () => {
    const lift = (requested: number[], floor: number[]) => requested.map((value, i) => Math.max(value, floor[i]));
    const result = resolveLiveFloor([1, 9], [5, 5], lift);
    expect(result.resolved).toEqual([5, 9]);
    expect(result.floored).toBe(true);
  });

  it('exposes the lift helper used for scalars', () => {
    expect(numericFloorLift(3, 8)).toBe(8);
    expect(numericFloorLift(8, 3)).toBe(8);
  });
});
