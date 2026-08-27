import React, { useRef, useState, useCallback, useEffect } from 'react';
import { matchesShortcut, shortcutLabel, type KeyboardShortcut } from './keyboard';

type Props = {
  /** Unique key for persisting the drag offset in localStorage. */
  storageKey: string;
  /**
   * Screen-space anchor point the button is positioned relative to.
   * The button sits at anchorPoint + offset. When the anchor moves
   * (e.g. due to pan/zoom), the button follows but the offset stays fixed.
   */
  anchorPoint: { x: number; y: number };
  /** Default offset from the anchor (screen-space pixels). */
  defaultOffset?: { x: number; y: number };
  /**
   * Bounds the button is clamped to (screen-space pixels).
   * The button's top-left will never leave this rectangle.
   */
  bounds?: { left: number; top: number; right: number; bottom: number };
  /** Button text label. */
  label: string;
  /** Tooltip shown on hover (uses data-tooltip). */
  tooltip?: string;
  /** Optional icon element rendered before the label. */
  icon?: React.ReactNode;
  /** Click handler (only fires if the button wasn't dragged). */
  onClick: () => void;
  shortcut: KeyboardShortcut;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** When defined, renders a checkbox indicator instead of an icon. */
  checked?: boolean;
  /** Additional class names. */
  className?: string;
};

// Approximate button dimensions for clamping (will be refined after mount if ref is available)
const BUTTON_WIDTH = 130;
const BUTTON_HEIGHT = 32;

export const FloatingButton: React.FC<Props> = ({
  storageKey,
  anchorPoint,
  defaultOffset = { x: 24, y: -48 },
  bounds,
  label,
  tooltip,
  icon,
  onClick,
  shortcut,
  disabled = false,
  checked,
  className = '',
}) => {
  // Always start at the default offset on mount. The parent should pass a
  // `key` that changes per selection so this component remounts fresh each time.
  const [offset, setOffset] = useState<{ x: number; y: number }>(defaultOffset);

  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [didDrag, setDidDrag] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  // Measure actual button size after mount for accurate clamping
  const [btnSize, setBtnSize] = useState({ w: BUTTON_WIDTH, h: BUTTON_HEIGHT });
  const measuredRef = useRef(false);
  useEffect(() => {
    if (measuredRef.current || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    if (rect.width > 0) {
      setBtnSize({ w: rect.width, h: rect.height });
      measuredRef.current = true;
    }
  }, [label]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, offX: offset.x, offY: offset.y };
    setDidDrag(false);
    setIsDragging(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [offset, disabled]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.mouseX;
    const dy = e.clientY - dragStart.current.mouseY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setDidDrag(true);
    setOffset({ x: dragStart.current.offX + dx, y: dragStart.current.offY + dy });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (dragStart.current) {
      try { localStorage.setItem(`floating_btn_offset_${storageKey}`, JSON.stringify(offset)); } catch {}
    }
    dragStart.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
  }, [offset, storageKey]);

  const handleClick = useCallback(() => {
    if (didDrag) return;
    onClick();
  }, [didDrag, onClick]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (disabled || !matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      onClick();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [disabled, onClick, shortcut]);

  // Compute screen position from anchor + offset
  let screenX = anchorPoint.x + offset.x;
  let screenY = anchorPoint.y + offset.y;

  // Clamp to bounds if provided
  if (bounds) {
    screenX = Math.max(bounds.left, Math.min(bounds.right - btnSize.w, screenX));
    screenY = Math.max(bounds.top, Math.min(bounds.bottom - btnSize.h, screenY));
  }

  const shortcutText = shortcutLabel(shortcut);
  const wideShortcut = shortcut.key === 'Delete' || shortcut.macKey === 'Backspace';

  return (
    <div
      ref={buttonRef}
      className={`floating-button ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${className}`}
      style={{ left: screenX, top: screenY }}
      data-tooltip={tooltip}
      aria-keyshortcuts={shortcutText}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleClick}
    >
      {checked !== undefined ? (
        <span className={`floating-button-checkbox ${checked ? 'checked' : ''}`}>
          {checked && (
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.5 6.5 L5 9 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      ) : (
        icon && <span className="floating-button-icon">{icon}</span>
      )}
      <span className="floating-button-label">{label}</span>
      <kbd className={`floating-button-shortcut ${wideShortcut ? 'wide' : ''}`}>{shortcutText}</kbd>
      <span className="floating-button-grip">
        <svg viewBox="0 0 4 12" width="4" height="12" aria-hidden="true">
          <circle cx="1" cy="2" r="1" fill="currentColor" />
          <circle cx="3" cy="2" r="1" fill="currentColor" />
          <circle cx="1" cy="6" r="1" fill="currentColor" />
          <circle cx="3" cy="6" r="1" fill="currentColor" />
          <circle cx="1" cy="10" r="1" fill="currentColor" />
          <circle cx="3" cy="10" r="1" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
};
