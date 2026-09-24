import React from 'react';
import { Check, ChevronLeft, ChevronRight, Gauge, Move, PenLine, RotateCcw, Route, Triangle, X, type LucideIcon } from 'lucide-react';
import { DEFAULT_SETTINGS, useEditorStore } from '../editor/editorStore';
import { PERFORMANCE_PRESETS, type PerformancePreset } from '../editor/performance';
import { GuidesPreview, MarkingsPreview, NavigationPreview, PerformancePreview, YieldPreview } from './SettingsPreviews';

type PageId = 'root' | 'performance' | 'navigation' | 'guides' | 'markings' | 'yield';

const PRESET_SHORT: Record<PerformancePreset, string> = {
  live: 'Live',
  balanced: 'Balanced',
  release: 'On release'
};

const PAGE_TITLES: Record<PageId, string> = {
  root: 'Settings',
  performance: 'Performance',
  navigation: 'Navigation',
  guides: 'Road Guides',
  markings: 'Lane Markings',
  yield: 'Approach & Openings'
};

const RevertButton: React.FC<{ dirty: boolean; label: string; onClick: () => void }> = ({ dirty, label, onClick }) => (
  <button
    type="button"
    className={`sp-revert${dirty ? ' dirty' : ''}`}
    data-tooltip={`Back to default (${label})`}
    aria-label={`Reset to default: ${label}`}
    tabIndex={dirty ? 0 : -1}
    onClick={e => {
      e.stopPropagation();
      onClick();
    }}
  >
    <RotateCcw size={11} />
  </button>
);

const SliderRow: React.FC<{
  title: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}> = ({ title, hint, min, max, step, value, defaultValue, format, onChange }) => (
  <label className="sp-row">
    <div className="sp-row-label">
      <strong>{title}</strong>
      <small>{hint}</small>
    </div>
    <div className="sp-row-control">
      <input className="sp-slider" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      <span className="sp-value">{format(value)}</span>
      <RevertButton dirty={value !== defaultValue} label={format(defaultValue)} onClick={() => onChange(defaultValue)} />
    </div>
  </label>
);

const NumberPairRow: React.FC<{
  title: string;
  hint: string;
  defaults: [number, number];
  first: { value: number; min: number; max: number; step: number; onChange: (value: number) => void };
  second: { value: number; min: number; max: number; step: number; onChange: (value: number) => void };
}> = ({ title, hint, defaults, first, second }) => (
  <div className="sp-row">
    <div className="sp-row-label">
      <strong>{title}</strong>
      <small>{hint}</small>
    </div>
    <div className="sp-row-control">
      {[first, second].map((field, i) => (
        <React.Fragment key={i}>
          <input
            className="sp-num"
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            value={field.value}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) field.onChange(v);
            }}
          />
          {i === 0 && <span className="sp-num-sep">/</span>}
        </React.Fragment>
      ))}
      <span className="sp-value">ft</span>
      <RevertButton
        dirty={first.value !== defaults[0] || second.value !== defaults[1]}
        label={`${defaults[0]} / ${defaults[1]} ft`}
        onClick={() => {
          first.onChange(defaults[0]);
          second.onChange(defaults[1]);
        }}
      />
    </div>
  </div>
);

const ToggleRow: React.FC<{ title: string; hint: string; value: boolean; defaultValue: boolean; onChange: (value: boolean) => void }> = ({ title, hint, value, defaultValue, onChange }) => (
  <div className="sp-row">
    <div className="sp-row-label">
      <strong>{title}</strong>
      <small>{hint}</small>
    </div>
    <div className="sp-row-control">
      <button type="button" role="switch" aria-checked={value} className={`sp-switch${value ? ' on' : ''}`} onClick={() => onChange(!value)}>
        <span className="sp-switch-knob" />
      </button>
      <RevertButton dirty={value !== defaultValue} label={defaultValue ? 'On' : 'Off'} onClick={() => onChange(defaultValue)} />
    </div>
  </div>
);

const NavRow: React.FC<{
  icon: LucideIcon;
  color: string;
  title: string;
  subtitle: string;
  value?: string;
  dirty?: boolean;
  onClick: () => void;
}> = ({ icon: Icon, color, title, subtitle, value, dirty, onClick }) => (
  <button type="button" className="sp-row sp-navrow" onClick={onClick}>
    <span className="sp-icon" style={{ background: color }}>
      <Icon size={15} />
    </span>
    <div className="sp-row-label">
      <strong>{title}</strong>
      <small>{subtitle}</small>
    </div>
    {dirty && <i className="sp-dirty-dot" />}
    {value && <span className="sp-navrow-value">{value}</span>}
    <ChevronRight size={15} className="sp-chevron" />
  </button>
);

const PreviewCard: React.FC<{ caption: string; children: React.ReactNode }> = ({ caption, children }) => (
  <div className="sp-preview">
    {children}
    <div className="sp-preview-caption">{caption}</div>
  </div>
);

const Group: React.FC<{ label?: string; footer?: string; revert?: React.ReactNode; children: React.ReactNode }> = ({ label, footer, revert, children }) => (
  <>
    {label && (
      <div className="sp-group-label">
        <span>{label}</span>
        {revert}
      </div>
    )}
    <div className="sp-group">{children}</div>
    {footer && <p className="sp-footer">{footer}</p>}
  </>
);

export const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useEditorStore(state => state.settings);
  const setSettings = useEditorStore(state => state.setSettings);
  const [stack, setStack] = React.useState<PageId[]>(['root']);
  const [animating, setAnimating] = React.useState<'push' | 'pop' | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const resetTimer = React.useRef<number | null>(null);
  const stackRef = React.useRef(stack);
  stackRef.current = stack;
  const animatingRef = React.useRef(animating);
  animatingRef.current = animating;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || animatingRef.current) return;
      if (stackRef.current.length > 1) setAnimating('pop');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  React.useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const push = (page: PageId) => {
    if (animating) return;
    setAnimating('push');
    setStack(s => [...s, page]);
  };

  const pop = () => {
    if (animating || stack.length < 2) return;
    setAnimating('pop');
  };

  const handleReset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      resetTimer.current = window.setTimeout(() => setConfirmReset(false), 2600);
      return;
    }
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    setConfirmReset(false);
    setSettings(DEFAULT_SETTINGS);
  };

  const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} ft`;
  const D = DEFAULT_SETTINGS;
  const dirty: Record<Exclude<PageId, 'root'>, boolean> = {
    performance: settings.performancePreset !== D.performancePreset,
    navigation: settings.zoomSensitivity !== D.zoomSensitivity || settings.panSensitivity !== D.panSensitivity || settings.smartZoom !== D.smartZoom,
    guides:
      settings.roadGuideLightness !== D.roadGuideLightness ||
      settings.roadGuideShadowStrength !== D.roadGuideShadowStrength ||
      settings.roadGuideShadowBlur !== D.roadGuideShadowBlur ||
      settings.roadGuideShadowOffsetY !== D.roadGuideShadowOffsetY,
    markings:
      settings.roadMarkingLineWidth !== D.roadMarkingLineWidth ||
      settings.roadMarkingWidthScale !== D.roadMarkingWidthScale ||
      settings.shortDashLength !== D.shortDashLength ||
      settings.shortDashGap !== D.shortDashGap ||
      settings.longDashLength !== D.longDashLength ||
      settings.longDashGap !== D.longDashGap,
    yield:
      settings.yieldSetback !== D.yieldSetback ||
      settings.ringLaneCollisionBuffer !== D.ringLaneCollisionBuffer ||
      settings.dividerSolidLength !== D.dividerSolidLength ||
      settings.dividerDottedLength !== D.dividerDottedLength
  };

  const pageBody = (page: PageId) => {
    switch (page) {
      case 'performance':
        return (
          <>
            <PreviewCard caption="Live preview — watch what stays responsive while a control is dragged.">
              <PerformancePreview settings={settings} />
            </PreviewCard>
            <Group
              label="Update detail"
              footer="Controls always track the pointer live. Higher-detail modes also rebuild pavement, markings, and effects while you drag."
              revert={
                <RevertButton
                  dirty={dirty.performance}
                  label={PERFORMANCE_PRESETS[D.performancePreset].label}
                  onClick={() => setSettings({ performancePreset: D.performancePreset })}
                />
              }
            >
              {(Object.entries(PERFORMANCE_PRESETS) as [PerformancePreset, (typeof PERFORMANCE_PRESETS)[PerformancePreset]][]).map(([preset, option]) => (
                <button
                  type="button"
                  key={preset}
                  className={`sp-row sp-choice${settings.performancePreset === preset ? ' active' : ''}`}
                  onClick={() => setSettings({ performancePreset: preset })}
                >
                  <div className="sp-row-label">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </div>
                  {settings.performancePreset === preset && <Check size={16} className="sp-check" />}
                </button>
              ))}
            </Group>
          </>
        );
      case 'navigation':
        return (
          <>
            <PreviewCard caption="Try it — this mini map responds exactly like the canvas.">
              <NavigationPreview settings={settings} />
            </PreviewCard>
            <Group label="Sensitivity">
              <SliderRow title="Zoom" hint="How fast pinch-to-zoom responds" min={0.05} max={1.5} step={0.01} value={settings.zoomSensitivity} defaultValue={D.zoomSensitivity} format={v => v.toFixed(2)} onChange={v => setSettings({ zoomSensitivity: v })} />
              <SliderRow title="Pan" hint="How fast two-finger panning responds" min={0.05} max={2} step={0.01} value={settings.panSensitivity} defaultValue={D.panSensitivity} format={v => v.toFixed(2)} onChange={v => setSettings({ panSensitivity: v })} />
            </Group>
            <Group label="Smart zoom" footer="When you drag or nudge a control near the screen edge, the view eases over to keep it in sight.">
              <ToggleRow title="Keep targets in view" hint="Pan the canvas to follow what you're dragging" value={settings.smartZoom} defaultValue={D.smartZoom} onChange={v => setSettings({ smartZoom: v })} />
            </Group>
          </>
        );
      case 'guides':
        return (
          <>
            <PreviewCard caption="Your roundabout rendered by the real editor — the dashed blue lines are the guides.">
              <GuidesPreview settings={settings} />
            </PreviewCard>
            <Group label="Line">
              <SliderRow title="Lightness" hint="How light the guide lines appear" min={40} max={90} step={1} value={settings.roadGuideLightness} defaultValue={D.roadGuideLightness} format={v => `${v}%`} onChange={v => setSettings({ roadGuideLightness: v })} />
            </Group>
            <Group label="Drop shadow" footer="A soft shadow behind the guide keeps it readable over light pavement and markings.">
              <SliderRow title="Strength" hint="How dark the shadow appears" min={0} max={1.5} step={0.05} value={settings.roadGuideShadowStrength} defaultValue={D.roadGuideShadowStrength} format={v => v.toFixed(2)} onChange={v => setSettings({ roadGuideShadowStrength: v })} />
              <SliderRow title="Blur" hint="How wide the shadow spreads" min={0} max={10} step={0.5} value={settings.roadGuideShadowBlur} defaultValue={D.roadGuideShadowBlur} format={v => v.toFixed(1)} onChange={v => setSettings({ roadGuideShadowBlur: v })} />
              <SliderRow title="Y offset" hint="Shift the shadow up or down to center it" min={-10} max={10} step={0.5} value={settings.roadGuideShadowOffsetY} defaultValue={D.roadGuideShadowOffsetY} format={v => v.toFixed(1)} onChange={v => setSettings({ roadGuideShadowOffsetY: v })} />
            </Group>
          </>
        );
      case 'markings':
        return (
          <>
            <PreviewCard caption="Your roundabout rendered by the real editor — paint, lane lines, and dash phasing update live.">
              <MarkingsPreview settings={settings} />
            </PreviewCard>
            <Group label="Paint">
              <SliderRow title="Line width" hint="Physical paint width — US default is 6 in (0.5 ft)" min={0.33} max={1} step={0.01} value={settings.roadMarkingLineWidth} defaultValue={D.roadMarkingLineWidth} format={v => `${v.toFixed(2)} ft`} onChange={v => setSettings({ roadMarkingLineWidth: v })} />
              <SliderRow title="Display scale" hint="Extra on-screen weight applied after the physical width" min={0.25} max={3} step={0.05} value={settings.roadMarkingWidthScale} defaultValue={D.roadMarkingWidthScale} format={v => `${v.toFixed(2)}×`} onChange={v => setSettings({ roadMarkingWidthScale: v })} />
            </Group>
            <Group label="Dash patterns" footer="Short dashes mark connector openings and lane extensions; long dashes continue down the lane. US defaults: 2 ft / 4 ft and 10 ft / 30 ft.">
              <NumberPairRow
                title="Short dash / gap" hint="Dotted extension pattern" defaults={[D.shortDashLength, D.shortDashGap]}
                first={{ value: settings.shortDashLength, min: 0.5, max: 10, step: 0.5, onChange: v => setSettings({ shortDashLength: v }) }}
                second={{ value: settings.shortDashGap, min: 0.5, max: 20, step: 0.5, onChange: v => setSettings({ shortDashGap: v }) }}
              />
              <NumberPairRow
                title="Long dash / gap" hint="Lane-line pattern" defaults={[D.longDashLength, D.longDashGap]}
                first={{ value: settings.longDashLength, min: 2, max: 30, step: 1, onChange: v => setSettings({ longDashLength: v }) }}
                second={{ value: settings.longDashGap, min: 2, max: 60, step: 1, onChange: v => setSettings({ longDashGap: v }) }}
              />
            </Group>
          </>
        );
      case 'yield':
        return (
          <>
            <PreviewCard caption="Your roundabout rendered by the real editor — yield teeth, ring openings, and divider phasing all update live.">
              <YieldPreview settings={settings} />
            </PreviewCard>
            <Group label="Yield markings" footer="Yield teeth are placed this distance before the lane first touches the ring pavement.">
              <SliderRow title="Setback" hint="Distance before the first ring-pavement intersection" min={0} max={30} step={0.5} value={settings.yieldSetback} defaultValue={D.yieldSetback} format={v => `${v.toFixed(1)} ft`} onChange={v => setSettings({ yieldSetback: v })} />
            </Group>
            <Group label="Ring openings" footer="The dashed outline in the preview is the lane footprint. Growing it makes wider gaps in the ring's edge lines; shrinking it tucks them in.">
              <SliderRow title="Collision buffer" hint="Expand or contract the lane footprint that breaks ring lines" min={-5} max={5} step={0.1} value={settings.ringLaneCollisionBuffer} defaultValue={D.ringLaneCollisionBuffer} format={signed} onChange={v => setSettings({ ringLaneCollisionBuffer: v })} />
            </Group>
            <Group label="Divider phasing" footer="Each lane divider starts solid at the road's end, runs dotted through the approach, then settles into the long-dash pattern toward the ring — measured from the start of each road.">
              <SliderRow title="Solid phase" hint="Length of solid divider from the road's start" min={0} max={100} step={1} value={settings.dividerSolidLength} defaultValue={D.dividerSolidLength} format={v => `${v.toFixed(0)} ft`} onChange={v => setSettings({ dividerSolidLength: v })} />
              <SliderRow title="Dotted phase" hint="Length of the short-dashed stretch after it" min={0} max={100} step={1} value={settings.dividerDottedLength} defaultValue={D.dividerDottedLength} format={v => `${v.toFixed(0)} ft`} onChange={v => setSettings({ dividerDottedLength: v })} />
            </Group>
          </>
        );
      case 'root':
        return (
          <>
            <h1 className="sp-large-title">Settings</h1>
            <Group label="Canvas">
              <NavRow icon={Gauge} color="#3b82f6" title="Performance" subtitle="Update detail during interactions" value={PRESET_SHORT[settings.performancePreset]} dirty={dirty.performance} onClick={() => push('performance')} />
              <NavRow icon={Move} color="#10b981" title="Navigation" subtitle="Zoom, pan & smart zoom" dirty={dirty.navigation} onClick={() => push('navigation')} />
            </Group>
            <Group label="Drawing">
              <NavRow icon={Route} color="#8b5cf6" title="Road Guides" subtitle="Centerline color & shadow" dirty={dirty.guides} onClick={() => push('guides')} />
              <NavRow icon={PenLine} color="#f59e0b" title="Lane Markings" subtitle="Paint width & dash patterns" dirty={dirty.markings} onClick={() => push('markings')} />
              <NavRow icon={Triangle} color="#ef4444" title="Approach & Openings" subtitle="Yield, divider phasing & ring gaps" dirty={dirty.yield} onClick={() => push('yield')} />
            </Group>
            <div className="sp-group sp-reset-group">
              <button type="button" className={`sp-row sp-reset${confirmReset ? ' confirm' : ''}`} onClick={handleReset}>
                {confirmReset ? 'Tap again to reset everything' : 'Reset All Settings'}
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        {stack.map((page, i) => {
          const top = i === stack.length - 1;
          const under = i === stack.length - 2;
          let cls = 'sp-page';
          if (top) {
            cls += animating === 'pop' ? ' sp-page-exit' : animating === 'push' ? ' sp-page-enter' : ' sp-page-top';
          } else if (under) {
            cls += animating === 'push' ? ' sp-page-recede' : animating === 'pop' ? ' sp-page-return' : '';
          }
          return (
            <div
              key={page}
              className={cls}
              onAnimationEnd={() => {
                if (animating === 'push' && top) setAnimating(null);
                if (animating === 'pop' && top) {
                  setStack(s => s.slice(0, -1));
                  setAnimating(null);
                }
              }}
            >
              <nav className="sp-navbar">
                <div className="sp-navbar-side">
                  {page !== 'root' && (
                    <button type="button" className="sp-back" onClick={pop}>
                      <ChevronLeft size={17} />
                      <span>Settings</span>
                    </button>
                  )}
                </div>
                {page !== 'root' && <strong className="sp-navbar-title">{PAGE_TITLES[page]}</strong>}
                <div className="sp-navbar-side sp-navbar-right">
                  <button type="button" className="settings-close" onClick={onClose}>
                    <X size={14} />
                  </button>
                </div>
              </nav>
              <div className="sp-scroll">{pageBody(page)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
