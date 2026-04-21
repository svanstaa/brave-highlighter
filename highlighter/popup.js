async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function escapeForDisplay(s) {
  return s.replace(/\s+/g, ' ').trim();
}

async function refresh() {
  const list = document.getElementById('list');
  list.innerHTML = '';

  const tab = await currentTab();
  if (!tab || !tab.id) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No active tab.';
    list.appendChild(li);
    return;
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_HIGHLIGHTS' });
  } catch {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Highlighter is not available on this page.';
    list.appendChild(li);
    return;
  }

  const items = (response && response.list) || [];
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No highlights on this page yet.';
    list.appendChild(li);
    return;
  }

  items
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((h) => {
      const li = document.createElement('li');

      const color = document.createElement('div');
      color.className = 'color';
      color.style.background = h.color || '#fff176';

      const text = document.createElement('div');
      text.className = 'text';
      const snippet = escapeForDisplay(h.text || '');
      text.textContent = snippet.length > 180 ? snippet.slice(0, 180) + '…' : snippet;

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_HIGHLIGHT', id: h.id });
        } catch {}
        refresh();
      });

      li.addEventListener('click', async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', id: h.id });
        } catch {}
      });

      li.appendChild(color);
      li.appendChild(text);
      li.appendChild(remove);
      list.appendChild(li);
    });
}

document.getElementById('clearAll').addEventListener('click', async () => {
  const tab = await currentTab();
  if (!tab || !tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ALL' });
  } catch {}
  refresh();
});

refresh();
