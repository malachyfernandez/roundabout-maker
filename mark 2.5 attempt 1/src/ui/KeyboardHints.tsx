import React from 'react';
import { hintKeyLabel, type KeyHint } from './keyHints';

function readHints(element: Element | null): KeyHint[] | null {
  const raw = element?.closest('[data-keys]')?.getAttribute('data-keys');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KeyHint[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

// Bottom-left keyboard reference. Shows the modifier-key hints declared by the
// hovered element (`data-keys`) and stays locked while its control is dragged —
// pointer capture retargets events to the layer root mid-drag, so the hints are
// captured on pointerdown instead of following pointermove targets.
export const KeyboardHints: React.FC = () => {
  const [hints, setHints] = React.useState<KeyHint[] | null>(null);
  const locked = React.useRef<KeyHint[] | null>(null);

  React.useEffect(() => {
    const move = (event: PointerEvent) => {
      if (locked.current) return;
      const raw = event.target;
      setHints(readHints(raw instanceof Element ? raw : null));
    };
    const down = (event: PointerEvent) => {
      const raw = event.target;
      locked.current = readHints(raw instanceof Element ? raw : null);
      if (locked.current) setHints(locked.current);
    };
    const up = () => { locked.current = null; };
    // Re-evaluate without a mouse move (e.g. after a pass-through key press),
    // matching the ActionTooltip re-evaluation channel.
    const reevaluate = (event: Event) => {
      if (locked.current) return;
      const detail = (event as CustomEvent).detail;
      if (!detail) return;
      setHints(readHints(detail.element ?? null));
    };
    const clear = () => { if (!locked.current) setHints(null); };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('tooltip-reevaluate', reevaluate);
    window.addEventListener('pointerleave', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('tooltip-reevaluate', reevaluate);
      window.removeEventListener('pointerleave', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);

  if (!hints) return null;
  return (
    <div className="key-hints">
      {hints.map((hint, index) => (
        <div key={index} className="key-hint">
          <kbd>{hintKeyLabel(hint.key)}</kbd>
          <span>{hint.action}</span>
        </div>
      ))}
    </div>
  );
};
