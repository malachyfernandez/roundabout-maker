import React, { useRef } from 'react';
import { type RoundaboutConfig } from '../config/types';
import { useEditorStore } from '../editor/editorStore';
import { removeRing } from '../editor/constraints';
import { estimateArmLength, getRoadProfile } from '../core/profile';
import { findLanePoint } from '../core/profile/authored';
import { MARKING_RULES } from '../rendering/markings';

const STORAGE_PREFIX = 'roundabout_';

/** Collect every persisted `roundabout_*` localStorage entry into one object. */
const exportPersistedState = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) out[key] = localStorage.getItem(key) ?? '';
  }
  return out;
};

/** Write a previously exported state object back into localStorage. */
const importPersistedState = (data: Record<string, string>) => {
  for (const key of Object.keys(data)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    localStorage.setItem(key, data[key]);
  }
};

type Props = {
  config: RoundaboutConfig;
  onChange: (config: RoundaboutConfig) => void;
  errors: string[];
};

export const Sidebar: React.FC<Props> = React.memo(({ config, onChange, errors }) => {
  const selection = useEditorStore(state => state.selection);
  const selections = useEditorStore(state => state.selections);
  const setSelection = useEditorStore(state => state.setSelection);
  const resetToDefault = useEditorStore(state => state.resetToDefault);
  const setActiveTool = useEditorStore(state => state.setActiveTool);
  const setPendingBypassSource = useEditorStore(state => state.setPendingBypassSource);
  const viewMode = useEditorStore(state => state.viewMode);
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data = exportPersistedState();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'roundabout-export.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Record<string, string>;
        if (typeof data !== 'object' || data === null) throw new Error('bad shape');
        importPersistedState(data);
        window.location.reload();
      } catch {
        window.alert('That file is not a valid roundabout export.');
      }
    };
    reader.readAsText(file);
    // reset so the same file can be picked again later
    e.target.value = '';
  };

  const handleChange = (updater: (draft: RoundaboutConfig) => void) => {
    const nextConfig = JSON.parse(JSON.stringify(config));
    updater(nextConfig);
    onChange(nextConfig);
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
      
      <p style={{ marginTop: 24, color: '#666', fontStyle: 'italic' }}>
        Click on the island, rings, or lanes in the viewport to edit their specific properties.
      </p>
      {viewMode !== 'segment' && (
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
            onChange(removeRing(config, ring.id));
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
            if (selection && 'armId' in selection && selection.armId === arm.id) {
              setSelection({ ...selection, armId: newId });
            }
          }} style={{marginLeft: 4, width: 150}} />
        </div>

        {selection?.kind === 'lane' && (
          <div style={{ marginBottom: 10, padding: '7px 9px', color: '#1e3a8a', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 12 }}>
            Editing {selection.dir === 'in' ? 'entry' : 'exit'} lane {selection.laneIndex + 1} — double-click its dashed path to add lane nodes; drag a node along the road to move it or sideways to shift the lane.
          </div>
        )}
        {selection?.kind === 'lane-node' && (() => {
          const point = findLanePoint(arm, getRoadProfile(arm, estimateArmLength(arm)), selection.dir, selection.laneIndex, selection.pointId);
          return (
            <div style={{ marginBottom: 10, padding: '7px 9px', color: '#1e3a8a', background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 6, fontSize: 12 }}>
              Lane node on {selection.dir === 'in' ? 'entry' : 'exit'} lane {selection.laneIndex + 1}{point ? `, ${Math.round(point.distance)} ft along the road` : ''}. Drag along the road to reposition it or sideways to shift the lane; its icons adjust offset and width.
            </div>
          );
        })()}

        {/* Entry Lanes */}
        <div style={{marginTop: 12, borderTop: '1px solid #ddd', paddingTop: 8}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong>Entry Lanes (In)</strong>
          </div>
          {arm.lanesIn.map((lane, li) => {
            const isLaneSelected = selections.some(selected => selected.kind === 'lane' && selected.armId === arm.id && selected.dir === 'in' && selected.laneIndex === li);
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
                  <span>From ring:</span>
                  <select value={lane.sourceRing ?? ''} onChange={e => handleChange(c => {
                    if (e.target.value) c.arms[i].lanesIn[li].sourceRing = e.target.value;
                    else delete c.arms[i].lanesIn[li].sourceRing;
                  })}>
                    <option value="">Automatic</option>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>To ring:</span>
                  <select value={lane.targetsRing ?? ''} onChange={e => handleChange(c => {
                    if (e.target.value) c.arms[i].lanesIn[li].targetsRing = e.target.value;
                    else delete c.arms[i].lanesIn[li].targetsRing;
                  })}>
                    <option value="">Automatic</option>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>Fillet R:</span>
                  <input type="number" value={lane.filletRadius} onChange={e => handleChange(c => c.arms[i].lanesIn[li].filletRadius = Number(e.target.value))} />
                  <span>Drops source:</span>
                  <input type="checkbox" checked={lane.dropsRing ?? false} onChange={e => handleChange(c => c.arms[i].lanesIn[li].dropsRing = e.target.checked)} />
                </div>
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
              </div>
            );
          })}
        </div>

        {/* Exit Lanes */}
        <div style={{marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 8}}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <strong>Exit Lanes (Out)</strong>
          </div>
          {arm.lanesOut.map((lane, li) => {
            const isLaneSelected = selections.some(selected => selected.kind === 'lane' && selected.armId === arm.id && selected.dir === 'out' && selected.laneIndex === li);
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
                  <span>From ring:</span>
                  <select value={lane.sourceRing ?? ''} onChange={e => handleChange(c => {
                    if (e.target.value) c.arms[i].lanesOut[li].sourceRing = e.target.value;
                    else delete c.arms[i].lanesOut[li].sourceRing;
                  })}>
                    <option value="">Automatic</option>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>To ring:</span>
                  <select value={lane.targetsRing ?? ''} onChange={e => handleChange(c => {
                    if (e.target.value) c.arms[i].lanesOut[li].targetsRing = e.target.value;
                    else delete c.arms[i].lanesOut[li].targetsRing;
                  })}>
                    <option value="">Automatic</option>
                    {config.rings.map(r => <option key={r.id} value={r.id}>{r.id}</option>)}
                  </select>
                  <span>Fillet R:</span>
                  <input type="number" value={lane.filletRadius} onChange={e => handleChange(c => c.arms[i].lanesOut[li].filletRadius = Number(e.target.value))} />
                  <span>Drops source:</span>
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
            onClick={handleExport}
            data-tooltip="Download the current design, settings, and viewport as a JSON file."
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            Export
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            data-tooltip="Load a previously exported JSON file. This replaces the current design."
            style={{ fontSize: 12, padding: '4px 8px' }}
          >
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
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
              {selections.length > 1 ? `Clear ${selections.length} selected` : 'Back to Global'}
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
      {selection && 'armId' in selection && renderArm(selection.armId)}
    </div>
  );
});
