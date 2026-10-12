function activateSettingsTab(root, tabId) {
  const buttons = root.querySelectorAll('[data-settings-tab]');
  const panels = root.querySelectorAll('[data-settings-panel]');
  let found = false;

  buttons.forEach((btn) => {
    const active = btn.dataset.settingsTab === tabId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) found = true;
  });

  panels.forEach((panel) => {
    const active = panel.dataset.settingsPanel === tabId;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });

  const formFooter = root.querySelector('.settings-tabs__footer--form');
  if (formFooter) formFooter.hidden = tabId === 'database';

  if (found) {
    history.replaceState(null, '', `#${tabId}`);
  }
}

function initSettingsTabs() {
  document.querySelectorAll('[data-settings-tabs]').forEach((root) => {
    const tabs = [...root.querySelectorAll('[data-settings-tab]')];
    if (!tabs.length) return;

    const defaultTab = tabs[0].dataset.settingsTab;
    const hashTab = location.hash.replace('#', '');
    const initialTab = tabs.some((t) => t.dataset.settingsTab === hashTab) ? hashTab : defaultTab;

    activateSettingsTab(root, initialTab);

    root.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-settings-tab]');
      if (!btn || !root.contains(btn)) return;
      activateSettingsTab(root, btn.dataset.settingsTab);
    });

    const resetInput = root.querySelector('[data-settings-reset-input]');
    const resetBtn = root.querySelector('[data-settings-reset-btn]');
    const resetPhrase = resetInput?.placeholder || '';

    function syncResetButton() {
      if (!resetBtn || !resetInput) return;
      resetBtn.disabled = resetInput.value.trim() !== resetPhrase;
    }

    resetInput?.addEventListener('input', syncResetButton);
    syncResetButton();
  });
}

document.addEventListener('DOMContentLoaded', initSettingsTabs);

export { initSettingsTabs };
