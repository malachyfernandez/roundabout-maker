import React from 'react';
import { X } from 'lucide-react';
import { useEditorStore } from '../editor/editorStore';

export const ToastLayer: React.FC = () => {
  const toasts = useEditorStore(state => state.toasts);
  const dismissToast = useEditorStore(state => state.dismissToast);

  return (
    <div className="toast-layer">
      {toasts.map(toast => (
        <div key={toast.id} className="toast">
          <div className="toast-content">
            <div className="toast-title">{toast.title}</div>
            {toast.subtitle && <div className="toast-subtitle">{toast.subtitle}</div>}
          </div>
          {toast.dismissible !== false && (
            <button className="toast-dismiss" onClick={() => dismissToast(toast.id)}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
