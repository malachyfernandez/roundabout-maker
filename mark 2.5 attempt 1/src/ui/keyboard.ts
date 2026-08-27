export type KeyboardShortcut = {
  key: string;
  macKey?: string;
  label?: string;
  macLabel?: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

export const DELETE_SHORTCUT: KeyboardShortcut = {
  key: 'Delete',
  macKey: 'Backspace',
  label: 'Del',
  macLabel: '⌫'
};

export function isMacPlatform() {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

export function shortcutLabel(shortcut: KeyboardShortcut) {
  const mac = isMacPlatform();
  const key = mac ? shortcut.macLabel ?? shortcut.label ?? shortcut.macKey ?? shortcut.key : shortcut.label ?? shortcut.key;
  return `${shortcut.mod ? (mac ? '⌘' : 'Ctrl+') : ''}${shortcut.shift ? (mac ? '⇧' : 'Shift+') : ''}${shortcut.alt ? (mac ? '⌥' : 'Alt+') : ''}${key}`;
}

export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut) {
  if (event.isComposing || event.repeat || isEditableKeyboardTarget(event.target)) return false;
  const mac = isMacPlatform();
  const key = mac ? shortcut.macKey ?? shortcut.key : shortcut.key;
  const matchesKey = key.length === 1 ? event.key.toLowerCase() === key.toLowerCase() : event.key === key;
  const matchesMod = shortcut.mod ? (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) : !event.metaKey && !event.ctrlKey;
  return matchesKey && matchesMod && event.shiftKey === Boolean(shortcut.shift) && event.altKey === Boolean(shortcut.alt);
}
