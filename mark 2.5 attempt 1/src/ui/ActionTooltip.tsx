import React from 'react';

type TooltipState = { text: string; x: number; y: number; error: boolean } | null;

function describeTarget(element: Element): { text: string; error: boolean } | null {
  const errorText = element.getAttribute('data-tooltip-error');
  if (errorText) return { text: errorText, error: true };
  const explicit = element.getAttribute('data-tooltip') || element.getAttribute('aria-label') || element.getAttribute('title');
  if (explicit) return { text: explicit, error: false };
  const target = element.getAttribute('data-target');
  if (target) {
    try {
      const parsed = JSON.parse(target);
      if (parsed.kind === 'lane') return { text: `Select ${parsed.dir === 'in' ? 'entry' : 'exit'} lane ${parsed.laneIndex + 1}.`, error: false };
      if (parsed.kind === 'arm') return { text: `Select road ${parsed.armId}.`, error: false };
      if (parsed.kind === 'ring') return { text: `Select ring ${parsed.ringId}.`, error: false };
      if (parsed.kind === 'island') return { text: 'Select the center island.', error: false };
    } catch {}
  }
  if (element.hasAttribute('data-handle')) return { text: 'Drag this gizmo to change the geometry.', error: false };
  if (element instanceof HTMLButtonElement) {
    const label = element.textContent?.trim();
    return { text: label ? `${element.disabled ? 'Unavailable: ' : 'Click to '}${label}.` : 'Click to perform this action.', error: false };
  }
  if (element instanceof HTMLSelectElement) return { text: 'Choose an option.', error: false };
  if (element instanceof HTMLInputElement) {
    if (element.type === 'range') return { text: 'Drag to adjust this value.', error: false };
    if (element.type === 'checkbox') return { text: 'Click to toggle this option.', error: false };
    if (element.type === 'file') return { text: 'Click to choose a file.', error: false };
    return { text: 'Click to edit this value.', error: false };
  }
  return null;
}

export const ActionTooltip: React.FC = () => {
  const [tooltip, setTooltip] = React.useState<TooltipState>(null);

  React.useEffect(() => {
    const computeTooltip = (clientX: number, clientY: number, element: Element | null) => {
      if (!element) return setTooltip(null);
      const result = describeTarget(element);
      if (!result) return setTooltip(null);
      setTooltip({ text: result.text, x: Math.min(clientX + 16, window.innerWidth - 340), y: Math.min(clientY + 18, window.innerHeight - 80), error: result.error });
    };
    const move = (event: PointerEvent) => {
      const raw = event.target;
      if (!(raw instanceof Element)) return setTooltip(null);
      const element = raw.closest('[data-tooltip-error], [data-tooltip], [data-target], [data-handle], button, input, select');
      computeTooltip(event.clientX, event.clientY, element);
    };
    // Re-evaluate tooltip without a mouse move (e.g. after pass-through key press)
    const reevaluate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail) return;
      const element = detail.element ?? null;
      computeTooltip(detail.x, detail.y, element);
    };
    const clear = () => setTooltip(null);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('tooltip-reevaluate', reevaluate);
    window.addEventListener('pointerleave', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('tooltip-reevaluate', reevaluate);
      window.removeEventListener('pointerleave', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);

  if (!tooltip) return null;
  return (
    <div className={tooltip.error ? 'action-tooltip action-tooltip-error' : 'action-tooltip'} style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
      {tooltip.text}
    </div>
  );
};
