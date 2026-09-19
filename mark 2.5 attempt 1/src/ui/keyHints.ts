// Reusable keyboard-reference hints. Interactive elements declare the modifier
// keys they support via a `data-keys` attribute (JSON KeyHint[]); the
// KeyboardHints overlay renders them in the bottom-left corner on hover —
// the same pattern ActionTooltip uses for `data-tooltip`.

export type KeyHint = { key: 'shift' | 'mod' | 'alt' | (string & {}); action: string };

export type DragModifiers = { shift: boolean; mod: boolean };

export const dragModifiers = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): DragModifiers => ({
  shift: event.shiftKey,
  mod: event.ctrlKey || event.metaKey
});

export const dataKeys = (...hints: KeyHint[]) => JSON.stringify(hints);

export const HINT = {
  isolateSection: { key: 'shift', action: 'Only this section' },
  noSnap: { key: 'mod', action: 'No snapping' }
} as const satisfies Record<string, KeyHint>;

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export const hintKeyLabel = (key: string) => {
  if (key === 'shift') return '⇧';
  if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
  if (key === 'alt') return isMac ? '⌥' : 'Alt';
  return key;
};
