/**
 * Live Floor — a reusable constraint pattern for user-editable values that
 * must never go below a geometry-dependent minimum, but must also restore
 * the user's chosen value once the minimum relaxes again.
 *
 * The pattern has three pieces of state:
 *
 * - `requested` — the value stored in config. It is always exactly what the
 *   user last asked for and is NEVER rewritten by the constraint. Drag
 *   handlers write here.
 * - `floor` — a dynamic minimum recomputed from the surrounding geometry
 *   every time the config is solved. It changes as roads, rings, and other
 *   elements move.
 * - `resolved` — the value rendering/geometry actually uses:
 *   `resolved = lift(requested, floor)`. When `requested >= floor` the
 *   resolved value IS the requested value, so moving the obstruction back
 *   automatically restores the user's original setting — nothing extra is
 *   stored.
 *
 * Because only `requested` is persisted, configs, exports, and undo history
 * always contain pure user intent; the floor is a pure function of the
 * config at solve time.
 *
 * See docs/LIVE-FLOOR.md at the project root for usage guidance.
 */

export type LiveFloorResolution<T> = {
  /** What the user asked for (the stored config value). */
  requested: T;
  /** The live minimum, or undefined when the value is unconstrained. */
  floor: T | undefined;
  /** What consumers should use. */
  resolved: T;
  /** True when the floor lifted resolved above requested. */
  floored: boolean;
};

/**
 * Resolve a stored `requested` value against a live `floor`.
 * `lift` decides how the two combine (for scalars this is `Math.max`).
 * A `floor` of `undefined` means "unconstrained" — resolved = requested.
 */
export function resolveLiveFloor<T>(
  requested: T,
  floor: T | undefined,
  lift: (requested: T, floor: T) => T
): LiveFloorResolution<T> {
  if (floor === undefined) return { requested, floor, resolved: requested, floored: false };
  const resolved = lift(requested, floor);
  return { requested, floor, resolved, floored: resolved !== requested };
}

/** Lift for scalar values: resolved is the larger of requested and floor. */
export const numericFloorLift = (requested: number, floor: number) => Math.max(requested, floor);

/** Convenience wrapper for the common scalar case. */
export function resolveNumericFloor(requested: number, floor?: number): LiveFloorResolution<number> {
  return resolveLiveFloor(requested, floor, numericFloorLift);
}
