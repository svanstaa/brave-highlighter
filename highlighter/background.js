chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'highlight-selection',
    title: 'Highlight selection',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'clear-page-highlights',
    title: 'Clear highlights on this page',
    contexts: ['page', 'action']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;
  if (info.menuItemId === 'highlight-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_SELECTION', color: '#fff176' }).catch(() => {});
  } else if (info.menuItemId === 'clear-page-highlights') {
    chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ALL' }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'highlight-selection' && tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'HIGHLIGHT_SELECTION', color: '#fff176' }).catch(() => {});
  }
});
