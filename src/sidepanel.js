'use strict';

import './sidepanel.css';
const { initializeLlmSidePanelChat } = require('./sidepanel-llm-chat');
const { initializeAiProviderSettings } = require('./sidepanel-ai-provider-settings');
const { initializeCrossrefPanel } = require('./sidepanel-crossref');
const { initializeTexPanel } = require('./sidepanel-tex');
const { initializeLanguageSwitch } = require('./i18n');

window.__WOS_AIDE_DOI_SIDE_PANEL__ = true;
window.clampPanelPosition = window.clampPanelPosition || ((options = {}) => ({
  top: Number.parseFloat(options.top) || Number(options.defaultTop) || 0,
  left: Number.parseFloat(options.left) || Number(options.defaultLeft) || 0
}));
const extensionVersion = chrome.runtime.getManifest()?.version || '';
if (extensionVersion) document.title = `Overleaf texAide v${extensionVersion}`;
initializeLanguageSwitch();
initializeLlmSidePanelChat();
initializeAiProviderSettings();
initializeCrossrefPanel();
initializeTexPanel();

(function initializeSettingsPanel() {
  const tabBar = document.querySelector('.tab-bar');
  const configurableTabs = [
    { tabId: 'tabLlm', toggleId: 'settingsShowLlmTab', storageKey: 'wosAideShowLlmTab', defaultVisible: false },
    { tabId: 'tabCrossref', toggleId: 'settingsShowCrossrefTab', storageKey: 'wosAideShowCrossrefTab', defaultVisible: true },
    { tabId: 'tabTexS2t', toggleId: 'settingsShowTexS2tTab', storageKey: 'wosAideShowTexS2tTab', defaultVisible: true },
    { tabId: 'tabTexBib', toggleId: 'settingsShowTexBibTab', storageKey: 'wosAideShowTexBibTab', defaultVisible: true },
    { tabId: 'tabTexTikz', toggleId: 'settingsShowTexTikzTab', storageKey: 'wosAideShowTexTikzTab', defaultVisible: true },
    { tabId: 'tabTexColor', toggleId: 'settingsShowTexColorTab', storageKey: 'wosAideShowTexColorTab', defaultVisible: true }
  ].map(config => ({
    ...config,
    tab: document.getElementById(config.tabId),
    toggle: document.getElementById(config.toggleId)
  }));
  const languageTab = document.getElementById('settingsLanguageSubTab');
  const supportTab = document.getElementById('settingsSupportSubTab');
  const aboutTab = document.getElementById('settingsAboutSubTab');
  const languagePanel = document.getElementById('settingsLanguageSubPanel');
  const supportPanel = document.getElementById('settingsSupportSubPanel');
  const aboutPanel = document.getElementById('settingsAboutSubPanel');
  const paymentOptions = Array.from(document.querySelectorAll('[data-support-payment]'));
  const paymentPanels = Array.from(document.querySelectorAll('[data-support-payment-panel]'));
  const macAppVideo = document.getElementById('supportMacAppVideo');
  const version = document.getElementById('settingsExtensionVersion');
  let selectedSupportPayment = 'wechat';
  if (version) version.textContent = extensionVersion || '-';

  const updateVisibleTabCount = () => {
    const count = document.querySelectorAll('.tab-bar .tab-button:not([hidden])').length;
    tabBar?.style.setProperty('--visible-tab-count', String(Math.max(1, count)));
  };
  const setTabVisible = (config, visible) => {
    const show = visible === true;
    if (config.tab) config.tab.hidden = !show;
    if (config.toggle) config.toggle.checked = show;
    updateVisibleTabCount();
    if (!show && config.tab?.classList.contains('is-active')) {
      document.querySelector('.tab-bar .tab-button:not([hidden])')?.click();
    }
  };
  const visibilityKeys = configurableTabs.map(config => config.storageKey);
  chrome.storage.local.get(visibilityKeys, result => {
    configurableTabs.forEach(config => {
      const stored = result[config.storageKey];
      setTabVisible(config, stored === undefined ? config.defaultVisible : stored === true);
    });
  });
  configurableTabs.forEach(config => {
    config.toggle?.addEventListener('change', () => {
      const show = config.toggle.checked;
      setTabVisible(config, show);
      chrome.storage.local.set({ [config.storageKey]: show });
    });
  });

  const stopMacAppVideo = () => {
    if (!macAppVideo) return;
    macAppVideo.pause();
    try { macAppVideo.currentTime = 0; } catch (_error) { /* metadata is not ready yet */ }
  };

  const playMacAppVideoOnce = () => {
    if (!macAppVideo) return;
    macAppVideo.pause();
    try { macAppVideo.currentTime = 0; } catch (_error) { /* metadata is not ready yet */ }
    const playback = macAppVideo.play();
    if (playback?.catch) playback.catch(() => {});
  };

  const setSettingsSubPanel = panelId => {
    const panels = [languagePanel, supportPanel, aboutPanel];
    const tabs = [languageTab, supportTab, aboutTab];
    const selectedPanel = panels.find(panel => panel?.id === panelId) || supportPanel;
    panels.forEach(panel => {
      if (panel) panel.hidden = panel !== selectedPanel;
    });
    tabs.forEach((tab, index) => {
      if (!tab) return;
      const active = panels[index] === selectedPanel;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    if (selectedPanel === supportPanel && selectedSupportPayment === 'mac-app') playMacAppVideoOnce();
    else stopMacAppVideo();
    chrome.storage.local.set({ wosAideSettingsPanel: selectedPanel?.id });
  };

  languageTab?.addEventListener('click', () => setSettingsSubPanel('settingsLanguageSubPanel'));
  supportTab?.addEventListener('click', () => setSettingsSubPanel('settingsSupportSubPanel'));
  aboutTab?.addEventListener('click', () => setSettingsSubPanel('settingsAboutSubPanel'));

  const setSupportPayment = payment => {
    const selectedPayment = paymentPanels.some(panel => panel.dataset.supportPaymentPanel === payment) ? payment : 'wechat';
    selectedSupportPayment = selectedPayment;
    paymentOptions.forEach(option => {
      const active = option.dataset.supportPayment === selectedPayment;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    paymentPanels.forEach(panel => {
      panel.hidden = panel.dataset.supportPaymentPanel !== selectedPayment;
    });
    if (selectedPayment === 'mac-app' && !supportPanel?.hidden) playMacAppVideoOnce();
    else stopMacAppVideo();
  };

  paymentOptions.forEach(option => {
    option.addEventListener('click', () => setSupportPayment(option.dataset.supportPayment));
  });
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.panel !== 'settingsPanel') {
        stopMacAppVideo();
        return;
      }
      setSettingsSubPanel('settingsSupportSubPanel');
      setSupportPayment('wechat');
      chrome.storage.local.get(['wosAideSettingsPanel'], result => {
        if (result.wosAideSettingsPanel) setSettingsSubPanel(result.wosAideSettingsPanel);
      });
    });
  });
  setSupportPayment('wechat');
  chrome.storage.local.get(['wosAideSettingsPanel'], result => {
    setSettingsSubPanel(result.wosAideSettingsPanel || 'settingsSupportSubPanel');
  });
})();

(function initializeSidePanel() {
  const activatePanel = panelId => {
    document.querySelectorAll('.tab-button').forEach(button => {
      const active = button.dataset.panel === panelId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.hidden = panel.id !== panelId;
      panel.classList.toggle('is-active', panel.id === panelId);
    });
    chrome.storage.local.set({ wosAideSidePanelTab: panelId });
  };
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => activatePanel(button.dataset.panel));
  });
  chrome.storage.local.get(['wosAideSidePanelTab'], result => {
    const requested = result.wosAideSidePanelTab;
    const button = document.querySelector('.tab-button[data-panel="' + requested + '"]');
    const fallback = document.querySelector('.tab-button:not([hidden])');
    activatePanel(button && !button.hidden ? requested : fallback?.dataset.panel || 'crossrefPanel');
  });
})();
