import { useRef, useState } from 'react';
import { type Vec2, add, len, sub } from '../math/vector';
import { screenToWorld } from '../viewport/transform';
import { useEditorStore } from '../editor/editorStore';
import { type RoundaboutConfig, type SelectionTarget } from '../config/types';
import { dragModifiers, type DragModifiers } from '../ui/keyHints';
import { duplicateSelectionOwners } from '../editor/duplicate';
import { selectionKey } from '../editor/selection';

export type HandleDragOptions = {
  zoom: number;
  /** Anchor point used to resolve the raw position for followPointer drags. */
  position?: Vec2;
  dragType?: string;
  dragTarget?: SelectionTarget;
  duplicateOwner?: boolean;
  followPointer?: boolean;
  resolveDragPosition?: (rawPosition: Vec2, originalConfig: RoundaboutConfig, modifiers: DragModifiers) => Vec2;
  onDragStart?: (modifiers: DragModifiers, originalConfig: RoundaboutConfig, startPoint: Vec2) => void;
  onDrag: (deltaWorld: Vec2, originalConfig: RoundaboutConfig, modifiers: DragModifiers, dragTarget?: SelectionTarget) => RoundaboutConfig;
  onDragEnd?: (deltaWorld: Vec2, originalConfig: RoundaboutConfig, clientPoint: Vec2, modifiers: DragModifiers, dragTarget?: SelectionTarget) => RoundaboutConfig | null;
  onDragCancel?: () => void;
  onClick?: (originalConfig: RoundaboutConfig) => RoundaboutConfig;
};

// Pointer-capture drag lifecycle shared by Handle and any other element that
// wants the same press-drag-release -> draft -> commit flow (e.g. the radius
// gizmo's invisible arc hit-band).
export function useHandleDrag({ zoom, position, dragType = 'handle', dragTarget, duplicateOwner = false, followPointer = false, resolveDragPosition, onDragStart, onDrag, onDragEnd, onDragCancel, onClick }: HandleDragOptions) {
  const setDraftConfig = useEditorStore(state => state.setDraftConfig);
  const commitDraft = useEditorStore(state => state.commitDraft);
  const committedConfig = useEditorStore(state => state.committedConfig);
  const setCommittedConfig = useEditorStore(state => state.setCommittedConfig);
  const setDrag = useEditorStore(state => state.setDrag);
  const setSelections = useEditorStore(state => state.setSelections);
  const setSelection = useEditorStore(state => state.setSelection);

  const startPt = useRef<Vec2 | null>(null);
  const startConfig = useRef<RoundaboutConfig | null>(null);
  const moved = useRef(false);
  const latestDelta = useRef<Vec2>({ x: 0, y: 0 });
  const activeDragTarget = useRef<SelectionTarget | undefined>(undefined);
  const selectionBeforeDuplicate = useRef<SelectionTarget[] | null>(null);
  const primaryBeforeDuplicate = useRef<SelectionTarget | null>(null);
  const additiveDown = useRef(false);
  const [dragOffset, setDragOffset] = useState<Vec2>({ x: 0, y: 0 });

  const reset = () => {
    startPt.current = null;
    startConfig.current = null;
    activeDragTarget.current = undefined;
    selectionBeforeDuplicate.current = null;
    primaryBeforeDuplicate.current = null;
    latestDelta.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // prevent Viewport from capturing
    e.currentTarget.setPointerCapture(e.pointerId);

    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    startPt.current = screenToWorld(e, svgEl);
    const modifiers = dragModifiers(e);
    additiveDown.current = modifiers.shift;
    let originalConfig = structuredClone(committedConfig);
    activeDragTarget.current = dragTarget;
    selectionBeforeDuplicate.current = null;
    primaryBeforeDuplicate.current = null;
    onDragStart?.(modifiers, originalConfig, startPt.current);
    if (modifiers.alt && duplicateOwner && dragTarget) {
      const currentState = useEditorStore.getState();
      const currentSelections = currentState.selections;
      selectionBeforeDuplicate.current = currentSelections;
      primaryBeforeDuplicate.current = currentState.selection;
      const duplicated = duplicateSelectionOwners(originalConfig, currentSelections);
      originalConfig = duplicated.config;
      activeDragTarget.current = duplicated.targetMap.get(selectionKey(dragTarget));
      setSelections(duplicated.selections, activeDragTarget.current);
      setDraftConfig(originalConfig);
    }
    startConfig.current = originalConfig;
    moved.current = false;
    latestDelta.current = { x: 0, y: 0 };
    setDragOffset({ x: 0, y: 0 });
    setDrag({ active: true, type: dragType });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPt.current || !startConfig.current) return;

    const svgEl = (e.currentTarget as Element).closest('svg');
    if (!svgEl) return;

    const currentPt = screenToWorld(e, svgEl);
    const delta = sub(currentPt, startPt.current);
    latestDelta.current = delta;
    if (followPointer && position) {
      const rawPosition = add(position, delta);
      const resolvedPosition = resolveDragPosition?.(rawPosition, startConfig.current, dragModifiers(e)) ?? rawPosition;
      setDragOffset(sub(resolvedPosition, position));
    }
    if (len(delta) > 2 * zoom) moved.current = true;

    const newConfig = onDrag(delta, startConfig.current, dragModifiers(e), activeDragTarget.current);
    setDraftConfig(newConfig);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startPt.current && startConfig.current) {
      if (!moved.current && selectionBeforeDuplicate.current) setSelections(selectionBeforeDuplicate.current, primaryBeforeDuplicate.current);
      // Pressing a member of a multi-selection keeps the group so it can be
      // dragged together; a plain click (no drag, no shift) collapses it here.
      if (!moved.current && dragTarget && !additiveDown.current) setSelection(dragTarget);
      if (!moved.current && onClick) {
        setDraftConfig(null);
        setCommittedConfig(onClick(startConfig.current));
        setDrag(null);
      } else if (moved.current && onDragEnd) {
        const result = onDragEnd(latestDelta.current, startConfig.current, { x: e.clientX, y: e.clientY }, dragModifiers(e), activeDragTarget.current);
        setDraftConfig(null);
        if (result) setCommittedConfig(result);
        else if (selectionBeforeDuplicate.current) setSelections(selectionBeforeDuplicate.current, primaryBeforeDuplicate.current);
        setDrag(null);
      } else if (moved.current) {
        commitDraft();
      } else {
        setDraftConfig(null);
        setDrag(null);
      }
      reset();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    setDraftConfig(null);
    setDrag(null);
    if (selectionBeforeDuplicate.current) setSelections(selectionBeforeDuplicate.current, primaryBeforeDuplicate.current);
    reset();
    onDragCancel?.();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleLostPointerCapture = () => {
    if (!startPt.current) return;
    setDraftConfig(null);
    setDrag(null);
    if (selectionBeforeDuplicate.current) setSelections(selectionBeforeDuplicate.current, primaryBeforeDuplicate.current);
    reset();
    onDragCancel?.();
  };

  return {
    /** True while a press started on the element is still held (read at render). */
    active: startPt.current !== null,
    dragOffset,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
  };
}
