function getSlideFrameElements(documentRef) {
  return [...documentRef.querySelectorAll('iframe')].filter((frame) =>
    /docs\.google\.com\/presentation|slide/i.test(frame.src || frame.title || ''),
  );
}

function applySlideFrameTransform(frame, state) {
  frame.style.width = `${state.width}%`;
  frame.style.minHeight = `${state.height}px`;
  frame.style.transform = `scale(${state.scale})`;
  frame.style.transformOrigin = 'top center';
  frame.style.display = 'block';
  frame.style.marginLeft = state.center ? 'auto' : '';
  frame.style.marginRight = state.center ? 'auto' : '';
}

function resetSlideFrameTransform(frame) {
  frame.style.removeProperty('width');
  frame.style.removeProperty('min-height');
  frame.style.removeProperty('transform');
  frame.style.removeProperty('transform-origin');
  frame.style.removeProperty('display');
  frame.style.removeProperty('margin-left');
  frame.style.removeProperty('margin-right');
}

function makeDraggable(panel, handle) {
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  function onPointerDown(event) {
    if (event.target.closest('input, button, label')) return;
    dragging = true;
    offsetX = event.clientX - panel.getBoundingClientRect().left;
    offsetY = event.clientY - panel.getBoundingClientRect().top;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragging) return;
    const x = Math.max(0, Math.min(event.clientX - offsetX, window.innerWidth - panel.offsetWidth));
    const y = Math.max(0, Math.min(event.clientY - offsetY, window.innerHeight - panel.offsetHeight));
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function onPointerUp() {
    dragging = false;
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);
}

export function createSlideResizeToolsController({
  document: documentRef,
  getCurrentSettings,
}) {
  let panel = null;
  let hidden = false;

  function ensureMounted() {
    const enabled = Boolean(getCurrentSettings()?.iniadPlus?.enableSlideResizeTools);
    const frames = getSlideFrameElements(documentRef);

    if (!enabled || !frames.length) {
      panel?.remove();
      panel = null;
      hidden = false;
      for (const frame of frames) resetSlideFrameTransform(frame);
      return;
    }

    if (hidden) return;

    if (!panel || !panel.isConnected) {
      panel = documentRef.createElement('aside');
      panel.className = 'um-slide-tools';
      panel.dataset.umModule = 'slide-tools';

      const header = documentRef.createElement('div');
      header.className = 'um-slide-tools-header';
      const title = documentRef.createElement('strong');
      title.textContent = 'Slide';
      const closeButton = documentRef.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'um-slide-tools-close';
      closeButton.textContent = '✕';
      closeButton.title = '閉じる（設定からOFFにもできます）';
      closeButton.addEventListener('click', () => {
        panel.remove();
        panel = null;
        hidden = true;
        for (const frame of getSlideFrameElements(documentRef)) resetSlideFrameTransform(frame);
      });
      header.append(title, closeButton);

      const controls = documentRef.createElement('div');
      controls.innerHTML = `
        <label>幅 <input data-um-slide="width" type="range" min="50" max="140" value="100"></label>
        <label>高さ <input data-um-slide="height" type="range" min="240" max="1200" value="540"></label>
        <label>拡大 <input data-um-slide="scale" type="range" min="0.5" max="1.8" step="0.05" value="1"></label>
        <label class="um-inline-check"><input data-um-slide="center" type="checkbox" checked>中央</label>
      `;

      panel.append(header, controls);
      panel.addEventListener('input', () => {
        const state = {
          width: Number(panel.querySelector('[data-um-slide="width"]').value),
          height: Number(panel.querySelector('[data-um-slide="height"]').value),
          scale: Number(panel.querySelector('[data-um-slide="scale"]').value),
          center: panel.querySelector('[data-um-slide="center"]').checked,
        };
        getSlideFrameElements(documentRef).forEach((frame) => applySlideFrameTransform(frame, state));
      });

      makeDraggable(panel, header);
      documentRef.body.append(panel);
    }

    panel.dispatchEvent(new Event('input'));
  }

  return { ensureMounted };
}
