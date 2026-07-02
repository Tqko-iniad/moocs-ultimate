export function createLectureToolsPanelController({
  document,
  findMountTarget,
  onAssignmentCheck,
}) {
  let panel = null;

  const setActivePane = (key) => {
    if (!panel) return;
    panel.dataset.activeTool = key || '';
    const panes = panel.querySelector('.um-lecture-tools-panes');
    if (panes) panes.hidden = !key;
    const closeButton = panel.querySelector('[data-um-tool-close]');
    if (closeButton) closeButton.hidden = !key;
    for (const tab of panel.querySelectorAll('[data-um-tool-tab]')) {
      const active = tab.getAttribute('data-um-tool-tab') === key;
      tab.setAttribute('aria-selected', String(active));
    }
    for (const pane of panel.querySelectorAll('[data-um-tool-pane]')) {
      pane.hidden = pane.getAttribute('data-um-tool-pane') !== key;
    }
  };

  const updateTab = (key, label, enabled = true) => {
    if (!panel) return;
    const tab = panel.querySelector(`[data-um-tool-tab="${key}"]`);
    if (!tab) return;
    const statusText = tab.dataset.umToolStatus || '';
    tab.replaceChildren();
    const main = document.createElement('span');
    main.className = 'um-tool-tab-main';
    main.textContent = label;
    tab.append(main);
    if (statusText) {
      const status = document.createElement('span');
      status.className = 'um-tool-tab-status';
      status.textContent = statusText;
      tab.append(status);
    }
    tab.hidden = !enabled;
    if (!enabled && panel.dataset.activeTool === key) {
      setActivePane('');
    }
  };

  const updateTabStatus = (key, statusText = '', statusState = '') => {
    if (!panel) return;
    const tab = panel.querySelector(`[data-um-tool-tab="${key}"]`);
    if (!tab) return;
    tab.dataset.umToolStatus = statusText;
    tab.dataset.umToolState = statusState;
    const label = tab.querySelector('.um-tool-tab-main')?.textContent || tab.textContent || key;
    updateTab(key, label, !tab.hidden);
    tab.title = statusText ? `${label}: ${statusText}` : label;
  };

  const handleClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest('[data-um-tool-tab]');
    if (tab) {
      const key = tab.getAttribute('data-um-tool-tab');
      setActivePane(panel?.dataset.activeTool === key ? '' : key);
      return;
    }
    if (target?.closest('[data-um-assignment-check]')) {
      onAssignmentCheck?.();
      return;
    }
    if (target?.closest('[data-um-tool-close]')) {
      setActivePane('');
    }
  };

  const ensurePanel = () => {
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'um-lecture-tools';
      panel.dataset.umModule = 'lecture-tools';
      panel.dataset.activeTool = '';
      panel.innerHTML = `
        <div class="um-lecture-tools-bar">
          <div>
            <span class="um-lecture-tools-kicker">MOOCS ULTIMATE</span>
            <strong>講義ツール</strong>
          </div>
          <div class="um-lecture-assignment-check" data-um-module="assignment-check">
            <button type="button" data-um-assignment-check>この回の課題を確認</button>
            <span class="um-lecture-assignment-status" data-state="idle">未確認</span>
          </div>
          <div class="um-lecture-tools-tabs" role="tablist" aria-label="MOOCs Ultimate 講義ツール">
            <button type="button" data-um-tool-tab="downloads" aria-selected="false" hidden>資料保存</button>
            <button type="button" data-um-tool-tab="ai" aria-selected="false" hidden>AI要約</button>
            <button type="button" data-um-tool-close hidden>閉じる</button>
          </div>
        </div>
        <div class="um-lecture-tools-panes" hidden>
          <div class="um-lecture-tool-pane" data-um-tool-pane="downloads" hidden></div>
          <div class="um-lecture-tool-pane" data-um-tool-pane="ai" hidden></div>
        </div>
        <div class="um-lecture-assignment-list" data-um-assignment-list hidden></div>
      `;
      panel.addEventListener('click', handleClick);
    }

    const mountTarget = findMountTarget();
    if (panel.parentElement !== mountTarget) {
      mountTarget.prepend(panel);
    }
    return panel;
  };

  return {
    ensurePanel,
    findPane(key) {
      return ensurePanel().querySelector(`[data-um-tool-pane="${key}"]`);
    },
    getPanel() {
      return panel;
    },
    remove() {
      panel?.remove();
      panel = null;
    },
    setActivePane,
    updateTab,
    updateTabStatus,
  };
}
