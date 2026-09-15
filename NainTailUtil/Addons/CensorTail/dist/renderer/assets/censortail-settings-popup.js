// A non-modal settings window: the preview and individual boxes stay interactive.
export function CommonSettingsPopup({ react: React, title, onClose, children }) {
  const { createElement: h, useEffect, useLayoutEffect, useRef, useState } = React;
  const panel = useRef(null);
  const drag = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, window.innerWidth - 340), y: 80,
  }));
  const bounded = (x, y) => ({
    x: Math.max(12, Math.min(x, window.innerWidth - (panel.current?.offsetWidth || 320) - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - (panel.current?.offsetHeight || 100) - 12)),
  });
  useLayoutEffect(() => {
    setPosition(p => bounded(p.x, p.y));
  }, [title]);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const keydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    const resize = () => setPosition(p => bounded(p.x, p.y));
    const observer = new ResizeObserver(resize);
    observer.observe(panel.current);
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', resize);
      observer.disconnect();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return h('section', {
    ref: panel, id: 'censor-common-popup', className: 'censor-common-popup',
    role: 'dialog', 'aria-modal': false, 'aria-labelledby': 'censor-common-popup-title',
    tabIndex: -1, style: { left: position.x, top: position.y },
  },
  h('header', {
    className: 'censor-common-popup-header',
    onPointerDown: event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      drag.current = { x: event.clientX, y: event.clientY, startX: position.x, startY: position.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove: event => {
      if (!drag.current) return;
      setPosition(bounded(drag.current.startX + event.clientX - drag.current.x,
        drag.current.startY + event.clientY - drag.current.y));
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onLostPointerCapture: () => { drag.current = null; },
  }, h('h2', { id: 'censor-common-popup-title' }, title),
  h('button', { type: 'button', 'aria-label': '공통 설정 닫기', onClick: onClose }, '닫기 ×')),
  h('div', { className: 'censor-common-popup-body' },
    h('p', { className: 'censor-settings-hint' }, '변경 즉시 반영됩니다. 제목을 끌어 창을 이동할 수 있습니다.'), children));
}
