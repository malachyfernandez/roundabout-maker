import React from 'react';
import { useEditorStore } from '../editor/editorStore';
import { Handle } from './Handle';
import { TangentHandle } from './TangentHandle';
import { dragIslandCenter, dragArmNode, dragTangentHandle } from '../editor/constraints';
import { getBezierSegment } from '../math/spline';
import { sub } from '../math/vector';

type Props = {
  zoom: number;
};

export const HandlesLayer: React.FC<Props> = ({ zoom }) => {
  const committedConfig = useEditorStore(state => state.committedConfig);
  const draftConfig = useEditorStore(state => state.draftConfig);
  const selection = useEditorStore(state => state.selection);
  const viewMode = useEditorStore(state => state.viewMode);
  const config = draftConfig || committedConfig;
  const showIslandCenter = selection?.kind === 'island';
  const islandX = config.island.center?.x || 0;
  const islandY = config.island.center?.y || 0;
  const activeArm = selection?.kind === 'arm'
    ? config.arms.find(arm => arm.id === selection.armId)
    : null;

  if (viewMode !== 'preview') return null;

  return (
    <g>
      {showIslandCenter && (
        <Handle
          x={islandX}
          y={islandY}
          zoom={zoom}
          cursor="move"
          fill="#dbeafe"
          stroke="#2563eb"
          onDrag={dragIslandCenter}
        />
      )}

      {activeArm && activeArm.nodes.flatMap((node, index) => {
        const handles = [];
        if (index > 0) {
          const segment = getBezierSegment(activeArm.nodes, index - 1);
          handles.push(
            <TangentHandle
              key={`${node.id}-in`}
              anchor={node.point}
              offset={sub(segment.c2, node.point)}
              zoom={zoom}
              onDrag={(delta, original) => dragTangentHandle(activeArm.id, node.id, 'in', delta, original)}
            />
          );
        }
        if (index < activeArm.nodes.length - 1) {
          const segment = getBezierSegment(activeArm.nodes, index);
          handles.push(
            <TangentHandle
              key={`${node.id}-out`}
              anchor={node.point}
              offset={sub(segment.c1, node.point)}
              zoom={zoom}
              onDrag={(delta, original) => dragTangentHandle(activeArm.id, node.id, 'out', delta, original)}
            />
          );
        }
        return handles;
      })}

      {activeArm && activeArm.nodes.map(node => (
        <Handle
          key={node.id}
          x={node.point.x}
          y={node.point.y}
          zoom={zoom}
          cursor="move"
          fill="#fff"
          stroke="#2563eb"
          onDrag={(delta, original) => dragArmNode(activeArm.id, node.id, delta, original)}
        />
      ))}
    </g>
  );
};
