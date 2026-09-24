import React from 'react';
import { Crosshair, Image as ImageIcon, ImagePlus, Ruler, Trash2, X } from 'lucide-react';

type Props = {
  hasImage: boolean;
  opacity: number;
  widthFt: number;
  heightFt: number;
  calibrating: boolean;
  onUploadFile: (file: File) => void;
  onOpacity: (value: number) => void;
  onWidthFt: (value: number) => void;
  onCalibrate: () => void;
  onCenter: () => void;
  onRemove: () => void;
  onUseDefault: () => void;
};

export const BackgroundPanel: React.FC<Props> = ({ hasImage, opacity, widthFt, heightFt, calibrating, onUploadFile, onOpacity, onWidthFt, onCalibrate, onCenter, onRemove, onUseDefault }) => {
  const [open, setOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Entering calibration needs unobstructed canvas clicks.
  React.useEffect(() => {
    if (calibrating) setOpen(false);
  }, [calibrating]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="bg-panel">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onUploadFile(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={`bg-panel-toggle${open ? ' active' : ''}`}
        data-tooltip="Reference image — upload a photo or plan to draw over."
        aria-label="Reference image"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <ImageIcon size={17} />
      </button>

      {open && (
        <div className="bg-popover">
          <div className="bg-popover-head">
            <strong>Reference image</strong>
            <button type="button" className="bg-icon-btn" data-tooltip="Close" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>

          {!hasImage ? (
            <div className="bg-empty">
              <button type="button" className="bg-primary-btn" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={14} />
                Upload image
              </button>
              <button type="button" className="bg-link-btn" onClick={onUseDefault}>
                Use sample aerial
              </button>
            </div>
          ) : (
            <>
              <label className="bg-row">
                <span>Opacity</span>
                <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => onOpacity(Number(e.target.value))} data-tooltip="How strongly the image shows through." />
              </label>
              <label className="bg-row">
                <span>Width</span>
                <span className="bg-num-wrap">
                  <input
                    type="number"
                    min={1}
                    value={Math.round(widthFt * 100) / 100}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) onWidthFt(v);
                    }}
                    data-tooltip="Image width in feet. Height follows the image's aspect ratio."
                  />
                  <em>ft</em>
                </span>
              </label>
              <div className="bg-dim">Height ≈ {heightFt.toFixed(1)} ft</div>
              <button type="button" className="bg-primary-btn" data-tooltip="Click two points on the image, then enter the real distance between them." onClick={() => { setOpen(false); onCalibrate(); }}>
                <Ruler size={14} />
                Calibrate scale
              </button>
              <div className="bg-actions">
                <button type="button" className="bg-icon-btn" data-tooltip="Replace image" aria-label="Replace image" onClick={() => fileRef.current?.click()}>
                  <ImagePlus size={14} />
                </button>
                <button type="button" className="bg-icon-btn" data-tooltip="Center image in current view" aria-label="Center in view" onClick={onCenter}>
                  <Crosshair size={14} />
                </button>
                <button type="button" className="bg-icon-btn danger" data-tooltip="Remove image" aria-label="Remove image" onClick={onRemove}>
                  <Trash2 size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
