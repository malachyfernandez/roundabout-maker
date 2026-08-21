import React from 'react';
import { isFeatureEnabled, useEditorStore } from '../editor/editorStore';

type TooltipState = { text: string; x: number; y: number } | null;

function describeTarget(element: Element): string | null {
  const explicit = element.getAttribute('data-tooltip') || element.getAttribute('aria-label') || element.getAttribute('title');
  if (explicit) return explicit;
  const target = element.getAttribute('data-target');
  if (target) {
    try {
      const parsed = JSON.parse(target);
      if (parsed.kind === 'lane') return `Select ${parsed.dir === 'in' ? 'entry' : 'exit'} lane ${parsed.laneIndex + 1}.`;
      if (parsed.kind === 'arm') return `Select road ${parsed.armId}.`;
      if (parsed.kind === 'ring') return `Select ring ${parsed.ringId}.`;
      if (parsed.kind === 'island') return 'Select the center island.';
    } catch {}
  }
  if (element.hasAttribute('data-handle')) return 'Drag this gizmo to change the geometry.';
  if (element instanceof HTMLButtonElement) {
    const label = element.textContent?.trim();
    return label ? `${element.disabled ? 'Unavailable: ' : 'Click to '}${label}.` : 'Click to perform this action.';
  }
  if (element instanceof HTMLSelectElement) return 'Choose an option.';
  if (element instanceof HTMLInputElement) {
    if (element.type === 'range') return 'Drag to adjust this value.';
    if (element.type === 'checkbox') return 'Click to toggle this option.';
    if (element.type === 'file') return 'Click to choose a file.';
    return 'Click to edit this value.';
  }
  return null;
}

export const ActionTooltip: React.FC = () => {
  const flags = useEditorStore(state => state.featureFlags);
  const [tooltip, setTooltip] = React.useState<TooltipState>(null);
  const enabled = isFeatureEnabled(flags, 'tooltips');

  React.useEffect(() => {
    if (!enabled) {
      setTooltip(null);
      return;
    }
    const move = (event: PointerEvent) => {
      const raw = event.target;
      if (!(raw instanceof Element)) return setTooltip(null);
      const element = raw.closest('[data-tooltip], [data-target], [data-handle], button, input, select');
      const text = element ? describeTarget(element) : null;
      if (!text) return setTooltip(null);
      setTooltip({ text, x: Math.min(event.clientX + 16, window.innerWidth - 340), y: Math.min(event.clientY + 18, window.innerHeight - 80) });
    };
    const clear = () => setTooltip(null);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerleave', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerleave', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, [enabled]);

  if (!tooltip) return null;
  return (
    <div className="action-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="tooltip">
      {tooltip.text}
    </div>
  );
};
