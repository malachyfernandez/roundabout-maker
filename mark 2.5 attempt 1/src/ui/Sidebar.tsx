import React from 'react';
import { type RoundaboutConfig } from '../config/types';
import { isFeatureEnabled, useEditorStore } from '../editor/editorStore';
import { RoadProfileEditor } from './RoadProfileEditor';
import { MARKING_RULES } from '../rendering/markings';

type Props = {
  config: RoundaboutConfig;
  onChange: (config: RoundaboutConfig) => void;
  errors: string[];
};

export const Sidebar: React.FC<Props> = ({ config, onChange, errors }) => {
  const selection = useEditorStore(state => state.selection);
  const setSelection = useEditorStore(state => state.setSelection);
  const resetToDefault = useEditorStore(state => state.resetToDefault);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const setPendingBypassSource = useEditorStore(state => state.setPendingBypassSource);
  const viewMode = useEditorStore(state => state.viewMode);
  const featureFlags = useEditorStore(state => state.featureFlags);
  const profileEnabled = isFeatureEnabled(featureFlags, 'roadProfiles');
  const creationToolsEnabled = isFeatureEnabled(featureFlags, 'creationTools');
  const bypassEnabled = isFeatureEnabled(featureFlags, 'bypassLanes');
  const renderedMarkingsEnabled = isFeatureEnabled(featureFlags, 'renderedMarkings');

  const handleChange = (updater: (draft: RoundaboutConfig) => void) => {
    const nextConfig = JSON.parse(JSON.stringify(config));
    updater(nextConfig);
    onChange(nextConfig);
  };

  const generateId = (prefix: string) => `${prefix}_${Math.random().toString(36).substr(2, 4)}`;

  const handleAddRing = () => {
    handleChange(c => {
      const maxRadius = c.rings.reduce((max, r) => Math.max(max, r.radius), 50);
      c.rings.push({
        id: generateId('ring'),
        center: { x: 0, y: 0 },
        radius: maxRadius + 12,
        width: 12
      });
    });
  };

  const handleRenameRing = (index: number, newId: string) => {
    handleChange(c => {
      const oldId = c.rings[index].id;
      c.rings[index].id = newId;
      for (const arm of c.arms) {
        for (const lane of arm.lanesIn) {
          if (lane.targetsRing === oldId) lane.targetsRing = newId;
        }
        for (const lane of arm.lanesOut) {
          if (lane.sourceRing === oldId) lane.sourceRing = newId;
        }
      }
      if (selection?.kind === 'ring' && selection.ringId === oldId) {
        setSelection({ ...selection, ringId: newId });
      }
    });
  };

  const handleAddArm = () => {
    handleChange(c => {
      const targetRing = c.rings[0]?.id || "";
      c.arms.push({
        id: generateId('arm'),
        nodes: [
          { id: generateId('node'), point: { x: 0, y: 0 }, medianWidth: 4, laneWidthsIn: targetRing ? [10] : [], laneWidthsOut: targetRing ? [10] : [] },
          { id: generateId('node'), point: { x: 0, y: -150 }, medianWidth: 4, laneWidthsIn: targetRing ? [10] : [], laneWidthsOut: targetRing ? [10] : [] }
        ],
        lanesIn: targetRing ? [{ targetsRing: targetRing, filletRadius: 40 }] : [],
        lanesOut: targetRing ? [{ sourceRing: targetRing, filletRadius: 40, dropsRing: false }] : []
      });
    });
  };

  const renderGlobal = () => (
    <div>
      <h3>Global Settings</h3>
      <label style={{display: 'block', marginBottom: 4}}>
        Circulation:
        <select 
          value={config.circulation} 
          onChange={e => handleChange(c => c.circulation = e.target.value as "ccw"|"cw")}
          style={{marginLeft: 8}}
        >
          <option value="ccw">CCW (Right-Hand Traffic)</option>
          <option value="cw">CW (Left-Hand Traffic)</option>
        </select>
      </label>
      
      {!creationToolsEnabled && (
        <div style={{ marginTop: 24 }}>
          <button data-tooltip="Add another circulatory ring." onClick={handleAddRing}>+ Add Ring</button>
          <button data-tooltip="Add another approach road." style={{ marginLeft: 8 }} onClick={handleAddArm}>+ Add Road</button>
        </div>
      )}
      
      <p style={{ marginTop: 24, color: '#666', fontStyle: 'italic' }}>
        Click on the island, rings, or lanes in the viewport to edit their specific properties.
      </p>
      {viewMode !== 'segment' && renderedMarkingsEnabled && (
        <details open style={{ marginTop: 18, padding: 10, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8 }}>
          <summary data-tooltip="Show the plain-language rules that generate the visible pavement markings." style={{ cursor: 'pointer', fontWeight: 700 }}>Rendered marking rules</summary>
          <p style={{ margin: '7px 0', color: '#64748b', fontSize: 11 }}>MUTCD-inspired schematic rules. Jurisdiction-specific engineering review is still required for construction use.</p>
          <ol style={{ margin: 0, paddingLeft: 18, color: '#334155', fontSize: 11, lineHeight: 1.4 }}>
            {MARKING_RULES.map(rule => <li key={rule} style={{ marginBottom: 4 }}>{rule}</li>)}
          </ol>
        </details>
      )}
    </div>
  );

  const renderIsland = () => (
    <div>
      <h3>Island Settings</h3>
      <label style={{display: 'block', marginBottom: 4}}>
        Center X (ft):
        <input type="range" min="-500" max="500" step="1" value={config.island.center?.x || 0} onChange={e => handleChange(c => { if (!c.island.center) c.island.center = {x:0, y:0}; c.island.center.x = Number(e.target.value); })} style={{marginLeft: 8, verticalAlign: 'middle'}} />
        <span style={{marginLeft: 8}}>{config.island.center?.x || 0}</span>
      </label>
      <label style={{display: 'block', marginBottom: 4}}>
        Center Y (ft):
        <input type="range" min="-500" max="500" step="1" value={config.island.center?.y || 0} onChange={e => handleChange(c => { if (!c.island.center) c.island.center = {x:0, y:0}; c.island.center.y = Number(e.target.value); })} style={{marginLeft: 8, verticalAlign: 'middle'}} />
        <span style={{marginLeft: 8}}>{config.island.center?.y || 0}</span>
      </label>
      <label style={{display: 'block', marginBottom: 4}}>
        Radius (ft):
        <input type="range" min="10" max="250" step="1" value={config.island.radius} onChange={e => handleChange(c => c.island.radius = Number(e.target.value))} style={{marginLeft: 8, verticalAlign: 'middle'}} />
        <span style={{marginLeft: 8}}>{config.island.radius}</span>
      </label>
    </div>
  );

  const renderRing = (ringId: string) => {
    const i = config.rings.findIndex(r => r.id === ringId);
    if (i < 0) return null;
    const ring = config.rings[i];
    return (
      <div>
        <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Ring: {ring.id}
          <button onClick={() => {
            handleChange(c => c.rings.splice(i, 1));
            setSelection(null);
          }} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </h3>
        <div style={{display: 'block', marginBottom: 12}}>
          <strong>Rename ID: </strong>
          <input type="text" value={ring.id} onChange={e => handleRenameRing(i, e.target.value)} style={{marginLeft: 4, width: 150}} />
        </div>
        <label style={{display: 'block', marginTop: 4}}>
          Center X (ft):
          <input type="range" min="-150" max="150" step="1" value={ring.center?.x || 0} onChange={e => handleChange(c => c.rings[i].center.x = Number(e.target.value))} style={{verticalAlign: 'middle', marginLeft: 8}} />
          <span style={{marginLeft: 8}}>{ring.center?.x || 0}</span>
        </label>
        <label style={{display: 'block', marginTop: 4}}>
          Center Y (ft):
          <input type="range" min="-150" max="150" step="1" value={ring.center?.y || 0} onChange={e => handleChange(c => c.rings[i].center.y = Number(e.target.value))} style={{verticalAlign: 'middle', marginLeft: 8}} />
          <span style={{marginLeft: 8}}>{ring.center?.y || 0}</span>
        </label>
        <label style={{display: 'block', marginTop: 4}}>
          Radius (ft):
          <input type="range" min="10" max="350" step="1" value={ring.radius} onChange={e => handleChange(c => c.rings[i].radius = Number(e.target.value))} style={{verticalAlign: 'middle', marginLeft: 8}} />
          <span style={{marginLeft: 8}}>{ring.radius}</span>
        </label>
        <label style={{display: 'block', marginTop: 4}}>
          Width (ft):
          <input type="range" min="2" max="40" step="1" value={ring.width} onChange={e => handleChange(c => c.rings[i].width = Number(e.target.value))} style={{verticalAlign: 'middle', marginLeft: 8}} />
          <span style={{marginLeft: 8}}>{ring.width}</span>
        </label>
      </div>
    );
  };

  const renderArm = (armId: string) => {
    const i = config.arms.findIndex(a => a.id === armId);
    if (i < 0) return null;
    const arm = config.arms[i];
    return (
      <div>
        <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Road: {arm.id}
          <button onClick={() => {
            handleChange(c => {
              const armId = c.arms[i].id;
              c.arms.splice(i, 1);
              c.bypasses = (c.bypasses ?? []).filter(connection => connection.fromArmId !== armId && connection.toArmId !== armId);
            });
            setSelection(null);
          }} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </h3>
        <div style={{display: 'block', marginBottom: 12}}>
          <strong style={{fontSize: 16}}>Rename Road ID: </strong>
          <input type="text" value={arm.id} onChange={e => {
            const newId = e.target.value;
            handleChange(c => {
              const oldId = c.arms[i].id;
              c.arms[i].id = newId;
              c.bypasses?.forEach(connection => {
                if (connection.fromArmId === oldId) connection.fromArmId = newId;
                if (connection.toArmId === oldId) connection.toArmId = newId;
              });
            });
            if ((selection?.kind === 'lane' || selection?.kind === 'arm') && selection.armId === arm.id) {
              setSelection({ ...selection, armId: newId });
            }
          }} style={{marginLeft: 4, width: 150}} />
        </div>

        {selection?.kind === 'lane' && (
          <div style={{ marginBottom: 10, padding: '7px 9px', color: '#1e3a8a', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 12 }}>
            Editing {selection.dir === 'in' ? 'entry' : 'exit'} lane {selection.laneIndex + 1}; the complete road remains highlighted in blue.
          </div>
        )}

        {profileEnabled && (
          <RoadProfileEditor
            arm={arm}
            onChange={updated => handleChange(c => { c.arms[i] = updated; })}
          />
        )}
        
        {/* Nodes Editor (Vertical) */}
        <div style={{marginTop: 12, borderTop: '1px solid #ddd', paddingTop: 8, display: profileEnabled ? 'none' : 'block'}}>
          <strong>Road shape</strong>
          <p style={{ margin: '4px 0 10px', color: '#64748b', fontSize: 12 }}>
            Drag the blue points and tangent nubs. Click or drag the blue centerline to add a point.
          </p>
          {arm.nodes.map((node, ni) => (
            <div key={node.id} style={{
              marginBottom: 8, padding: 8, 
              background: 'rgba(0,0,0,0.05)', 
              border: '1px solid #ccc', 
              borderRadius: 4
            }}>
              <div><strong>Node {ni}</strong></div>
              <label style={{display: 'block', marginTop: 4}}>
                Median Width (ft):
                <input type="range" min="0" max="30" step="1" value={node.medianWidth} onChange={e => handleChange(c => c.arms[i].nodes[ni].medianWidth = Number(e.target.value))} style={{verticalAlign: 'middle', marginLeft: 8}} />
                <span style={{marginLeft: 8}}>{node.medianWidth}</span>
              </label>
              
              <div style={{display: 'flex', gap: 8, marginTop: 4}}>
                {node.laneWidthsIn.map((w, li) => (
                  <label key={`in-${li}`} style={{fontSize: 12}}>In {li}: <input type="number" style={{width:40}} value={w} onChange={e => handleChange(c => c.arms[i].nodes[ni].laneWidthsIn[li] = Number(e.target.value))} /></label>
                ))}
              </div>
              <div style={{display: 'flex', gap: 8, marginTop: 4}}>
                {node.laneWidthsOut.map((w, li) => (
                  <label key={`out-${li}`} style={{fontSize: 12}}>Out {li}: <input type="number" style={{width:40}} value={w} onChange={e => handleChange(c => c.arms[i].nodes[ni].laneWidthsOut[li] = Number(e.target.value))} /></label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Entry Lanes */}
        <div style={{marginTop: 12, borderTop: '1px solid #ddd', paddingTop: 8}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong>Entry Lanes (In)</strong>
            {!profileEnabled && (
              <button onClick={() => handleChange(c => {
                c.arms[i].lanesIn.push({ targetsRing: c.rings[0]?.id || "", filletRadius: 40 });
                c.arms[i].nodes.forEach(n => n.laneWidthsIn.push(10));
              })} style={{ fontSize: 10, padding: '2px 4px' }}>+ Add Lane</button>
            )}
          </div>
          {arm.lanesIn.map((lane, li) => {
            const isLaneSelected = selection?.kind === 'lane' && selection.armId === arm.id && selection.dir === 'in' && selection.laneIndex === li;
            const bypass = config.bypasses?.find(connection => connection.fromArmId === arm.id && connection.fromLaneIndex === li);
            return (
              <div key={li} style={{
                marginBottom: 8, padding: 8, 
                background: isLaneSelected ? '#e3f2fd' : 'rgba(255,255,255,0.5)', 
                border: '1px solid',
                borderColor: isLaneSelected ? '#2196f3' : '#ccc', 
                borderRadius: 4, position: 'relative'
              }}>
                <button onClick={() => handleChange(c => {
                  const armId = c.arms[i].id;
                  c.arms[i].lanesIn.splice(li, 1);
                  c.arms[i].nodes.forEach(n => n.laneWidthsIn.splice(li, 1));
                  c.arms[i].profile?.forEach(point => point.lanesIn.splice(li, 1));
                  c.bypasses = (c.bypasses ?? []).filter(connection => connection.fromArmId !== armId || connection.fromLaneIndex !== li);
                  c.bypasses.forEach(connection => { if (connection.fromArmId === armId && connection.fromLaneIndex > li) connection.fromLaneIndex--; });
                })} style={{ position: 'absolute', top: 2, right: 2, color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', alignItems: 'center', paddingRight: 16 }}>
                  <span>Target:</span>
                  <select value={lane.targetsRing} onChange={e => handleChange(c => c.arms[i].lanesIn[li].targetsRing = e.target.value)}>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>Fillet R:</span>
                  <input type="number" value={lane.filletRadius} onChange={e => handleChange(c => c.arms[i].lanesIn[li].filletRadius = Number(e.target.value))} />
                </div>
                {bypassEnabled && (
                  <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid #dbe3ee' }}>
                    {bypass ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, color: '#166534', fontSize: 11 }}>
                        <span>Right turn → {bypass.toArmId}, exit {bypass.toLaneIndex + 1}</span>
                        <button
                          data-tooltip="Remove this direct right-turn connection and reconnect both lanes to their rings."
                          onClick={() => handleChange(c => { c.bypasses = (c.bypasses ?? []).filter(connection => connection.id !== bypass.id); })}
                        >Remove</button>
                      </div>
                    ) : (
                      <button
                        data-tooltip="Start a right-turn bypass from this entry lane, then click a highlighted exit lane on another road."
                        onClick={() => {
                          setSelection({ kind: 'lane', armId: arm.id, dir: 'in', laneIndex: li });
                          setPendingBypassSource({ armId: arm.id, laneIndex: li });
                          setActiveTool('connect-bypass');
                        }}
                      >Connect right-turn bypass…</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Exit Lanes */}
        <div style={{marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 8}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong>Exit Lanes (Out)</strong>
            {!profileEnabled && (
              <button onClick={() => handleChange(c => {
                c.arms[i].lanesOut.push({ sourceRing: c.rings[0]?.id || "", filletRadius: 40, dropsRing: false });
                c.arms[i].nodes.forEach(n => n.laneWidthsOut.push(10));
              })} style={{ fontSize: 10, padding: '2px 4px' }}>+ Add Lane</button>
            )}
          </div>
          {arm.lanesOut.map((lane, li) => {
            const isLaneSelected = selection?.kind === 'lane' && selection.armId === arm.id && selection.dir === 'out' && selection.laneIndex === li;
            return (
              <div key={li} style={{
                marginBottom: 8, padding: 8, 
                background: isLaneSelected ? '#e3f2fd' : 'rgba(255,255,255,0.5)', 
                border: '1px solid',
                borderColor: isLaneSelected ? '#2196f3' : '#ccc', 
                borderRadius: 4, position: 'relative'
              }}>
                <button onClick={() => handleChange(c => {
                  const armId = c.arms[i].id;
                  c.arms[i].lanesOut.splice(li, 1);
                  c.arms[i].nodes.forEach(n => n.laneWidthsOut.splice(li, 1));
                  c.arms[i].profile?.forEach(point => point.lanesOut.splice(li, 1));
                  c.bypasses = (c.bypasses ?? []).filter(connection => connection.toArmId !== armId || connection.toLaneIndex !== li);
                  c.bypasses.forEach(connection => { if (connection.toArmId === armId && connection.toLaneIndex > li) connection.toLaneIndex--; });
                })} style={{ position: 'absolute', top: 2, right: 2, color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>✕</button>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', alignItems: 'center', paddingRight: 16 }}>
                  <span>Source:</span>
                  <select value={lane.sourceRing} onChange={e => handleChange(c => c.arms[i].lanesOut[li].sourceRing = e.target.value)}>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>Fillet R:</span>
                  <input type="number" value={lane.filletRadius} onChange={e => handleChange(c => c.arms[i].lanesOut[li].filletRadius = Number(e.target.value))} />
                  <span>Drops Ring:</span>
                  <input type="checkbox" checked={lane.dropsRing} onChange={e => handleChange(c => c.arms[i].lanesOut[li].dropsRing = e.target.checked)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ width: 450, padding: 16, borderRight: '1px solid #ccc', overflowY: 'auto', backgroundColor: '#fff', fontSize: 14 }}>
      <h2 style={{marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        Editor
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              if (window.confirm('Reset the design, background, and viewport to their defaults?')) resetToDefault();
            }}
            style={{ fontSize: 12, padding: '4px 8px', color: '#b91c1c' }}
          >
            Reset All
          </button>
          <select 
            value={useEditorStore(state => state.viewMode)}
            onChange={e => useEditorStore.getState().setViewMode(e.target.value as 'segment' | 'editor' | 'rendered')}
            style={{ fontSize: 12, padding: '2px 4px' }}
          >
            <option value="segment">Segment Mode</option>
            <option value="editor">Editor Mode</option>
            <option value="rendered">Rendered Mode</option>
          </select>
          {selection && (
            <button onClick={() => setSelection(null)} style={{ fontSize: 12, padding: '4px 8px' }}>
              Back to Global
            </button>
          )}
        </div>
      </h2>
      
      {errors.length > 0 && (
        <div style={{ background: '#fdd', padding: 8, marginBottom: 16, borderRadius: 4, color: 'red' }}>
          <strong>Validation Errors:</strong>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {!selection && renderGlobal()}
      {selection?.kind === 'island' && renderIsland()}
      {selection?.kind === 'ring' && renderRing(selection.ringId)}
      {(selection?.kind === 'lane' || selection?.kind === 'arm') && renderArm(selection.armId)}
    </div>
  );
};
