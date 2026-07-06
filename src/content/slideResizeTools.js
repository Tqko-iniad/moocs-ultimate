const SLIDE_TOOLS_HIDDEN_STORAGE_KEY = 'um_slideToolsHidden';

function readSlideToolsHiddenFlag() {
  try {
    return sessionStorage.getItem(SLIDE_TOOLS_HIDDEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSlideToolsHiddenFlag(value) {
  try {
    if (value) sessionStorage.setItem(SLIDE_TOOLS_HIDDEN_STORAGE_KEY, 'true');
    else sessionStorage.removeItem(SLIDE_TOOLS_HIDDEN_STORAGE_KEY);
  } catch {
    // sessionStorage unavailable (e.g. private mode); fall back to in-memory only.
  }
}

function getSlideFrameElements(documentRef) {
  return [...documentRef.querySelectorAll('iframe')].filter((frame) =>
    /docs\.google\.com\/presentation|slide/i.test(frame.src || frame.title || ''),
  );
}

function findBookmarkButtonElement(documentRef) {
  for (const el of documentRef.querySelectorAll('a, button, [role="button"]')) {
    if (el.closest('[data-um-module], [data-um-owned="true"]')) continue;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^(?:🔖\s*)?bookmark$/i.test(text)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
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
  let reopenButton = null;
  let hidden = readSlideToolsHiddenFlag();

  function removeReopenButton() {
    reopenButton?.remove();
    reopenButton = null;
  }

  function ensureMounted() {
    const enabled = Boolean(getCurrentSettings()?.iniadPlus?.enableSlideResizeTools);
    const frames = getSlideFrameElements(documentRef);

    if (!enabled || !frames.length) {
      panel?.remove();
      panel = null;
      removeReopenButton();
      hidden = false;
      for (const frame of frames) resetSlideFrameTransform(frame);
      return;
    }

    if (hidden) {
      if (!reopenButton || !reopenButton.isConnected) {
        reopenButton = documentRef.createElement('button');
        reopenButton.type = 'button';
        reopenButton.className = 'um-slide-tools-reopen';
        reopenButton.dataset.umModule = 'slide-tools-reopen';
        reopenButton.textContent = 'Slide';
        reopenButton.title = 'スライド表示調整パネルを開く';
        reopenButton.addEventListener('click', () => {
          hidden = false;
          writeSlideToolsHiddenFlag(false);
          removeReopenButton();
          ensureMounted();
        });
      }

      const bookmarkButton = findBookmarkButtonElement(documentRef);
      if (bookmarkButton) {
        reopenButton.classList.add('um-slide-tools-reopen-anchored');
        if (reopenButton.previousElementSibling !== bookmarkButton) {
          bookmarkButton.insertAdjacentElement('beforebegin', reopenButton);
        }
      } else {
        reopenButton.classList.remove('um-slide-tools-reopen-anchored');
        if (!reopenButton.isConnected) documentRef.body.append(reopenButton);
      }
      return;
    }

    removeReopenButton();

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
      closeButton.title = '閉じる（他ページに移動しても「Slide」ボタンを押すまで再表示しません）';
      closeButton.addEventListener('click', () => {
        panel.remove();
        panel = null;
        hidden = true;
        writeSlideToolsHiddenFlag(true);
        for (const frame of getSlideFrameElements(documentRef)) resetSlideFrameTransform(frame);
        ensureMounted();
      });
      header.append(title, closeButton);

      const presets = documentRef.createElement('div');
      presets.className = 'um-slide-tools-presets';
      presets.innerHTML = `
        <button type="button" data-um-slide-preset="100">全画面幅</button>
        <button type="button" data-um-slide-preset="75">75%</button>
        <button type="button" data-um-slide-preset="50">50%</button>
      `;

      const controls = documentRef.createElement('div');
      controls.innerHTML = `
        <label>幅 <input data-um-slide="width" type="range" min="50" max="140" value="100"></label>
        <label>高さ <input data-um-slide="height" type="range" min="240" max="1200" value="540"></label>
        <label>拡大 <input data-um-slide="scale" type="range" min="0.5" max="1.8" step="0.05" value="1"></label>
        <label class="um-inline-check"><input data-um-slide="center" type="checkbox" checked>中央</label>
      `;

      panel.append(header, presets, controls);
      panel.addEventListener('input', () => {
        const state = {
          width: Number(panel.querySelector('[data-um-slide="width"]').value),
          height: Number(panel.querySelector('[data-um-slide="height"]').value),
          scale: Number(panel.querySelector('[data-um-slide="scale"]').value),
          center: panel.querySelector('[data-um-slide="center"]').checked,
        };
        getSlideFrameElements(documentRef).forEach((frame) => applySlideFrameTransform(frame, state));
      });
      presets.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-um-slide-preset]') : null;
        if (!button) return;
        const widthInput = panel.querySelector('[data-um-slide="width"]');
        widthInput.value = button.dataset.umSlidePreset;
        widthInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      makeDraggable(panel, header);
      documentRef.body.append(panel);
    }

    panel.dispatchEvent(new Event('input'));
  }

  return { ensureMounted };
}
