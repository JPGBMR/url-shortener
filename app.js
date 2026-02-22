const state = {
  inputValue: '',
  isLoading: false,
  result: null,      // { shortUrl, longUrl }
  history: [],       // [{ shortUrl, longUrl, ts }], max 10
  error: null
};

const HISTORY_KEY = 'url_shortener_history';
const URL_REGEX = /^https?:\/\/.+\..+/;

// ─── Shorten API ─────────────────────────────────────────────

async function shortenUrl(url) {
  const encoded = encodeURIComponent(url);

  // Primary: is.gd
  try {
    const res = await fetch(`https://is.gd/create.php?format=json&url=${encoded}`);
    if (res.ok) {
      const data = await res.json();
      if (!data.errorcode) return data.shorturl;
    }
  } catch (_) { /* fall through to fallback */ }

  // Fallback: tinyurl (returns plain text)
  const res2 = await fetch(`https://tinyurl.com/api-create.php?url=${encoded}`);
  if (!res2.ok) throw new Error('Both shortening services failed.');
  const text = await res2.text();
  if (text.startsWith('Error')) throw new Error(text);
  return text.trim();
}

// ─── QR Code ─────────────────────────────────────────────────

function renderQR(shortUrl) {
  const container = document.getElementById('qr-container');
  container.innerHTML = '';
  new QRCode(container, {
    text: shortUrl,
    width: 128,
    height: 128,
    colorDark: '#111111',
    colorLight: '#ffffff'
  });
}

function downloadQR() {
  const container = document.getElementById('qr-container');

  // qrcodejs renders either <canvas> or <img> depending on browser
  const findAndDownload = () => {
    const canvas = container.querySelector('canvas');
    const img = container.querySelector('img');

    let dataUrl;
    if (canvas) {
      dataUrl = canvas.toDataURL('image/png');
    } else if (img) {
      // Draw img to offscreen canvas for PNG export
      const c = document.createElement('canvas');
      c.width = img.width || 128;
      c.height = img.height || 128;
      c.getContext('2d').drawImage(img, 0, 0);
      dataUrl = c.toDataURL('image/png');
    } else {
      return false;
    }

    const a = document.createElement('a');
    a.download = 'qr-code.png';
    a.href = dataUrl;
    a.click();
    return true;
  };

  // qrcodejs renders async — small delay to locate canvas/img
  if (!findAndDownload()) {
    setTimeout(() => findAndDownload(), 100);
  }
}

// ─── Clipboard ───────────────────────────────────────────────

async function copyToClipboard(text, btn, label = 'Copy') {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = label; }, 1500);
  } catch (_) {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = label; }, 1500);
  }
}

// ─── History ─────────────────────────────────────────────────

function loadHistory() {
  try {
    state.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch (_) {
    state.history = [];
    localStorage.removeItem(HISTORY_KEY);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch (_) { /* storage full — skip */ }
}

function addToHistory(shortUrl, longUrl) {
  state.history.unshift({ shortUrl, longUrl, ts: Date.now() });
  if (state.history.length > 10) state.history.length = 10;
  saveHistory();
}

function formatTs(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Render ──────────────────────────────────────────────────

function render() {
  const input = document.getElementById('url-input');
  const shortenBtn = document.getElementById('shorten-btn');
  const errorEl = document.getElementById('url-error');
  const counterEl = document.getElementById('char-counter');
  const resultCard = document.getElementById('result-card');
  const shortUrlEl = document.getElementById('short-url');
  const historyList = document.getElementById('history-list');

  // Input sync
  if (input.value !== state.inputValue) input.value = state.inputValue;

  // Char counter
  const len = state.inputValue.length;
  if (len > 0) {
    counterEl.textContent = `${len} / 2048`;
    counterEl.className = 'char-counter' + (len > 2000 ? ' warn' : '');
  } else {
    counterEl.textContent = '';
    counterEl.className = 'char-counter';
  }

  // Shorten button
  const valid = URL_REGEX.test(state.inputValue) && state.inputValue.length <= 2048;
  shortenBtn.disabled = !valid || state.isLoading;
  shortenBtn.setAttribute('aria-busy', state.isLoading ? 'true' : 'false');
  shortenBtn.textContent = state.isLoading ? 'Shortening…' : 'Shorten';

  // Error
  if (state.error) {
    errorEl.textContent = state.error;
    errorEl.hidden = false;
  } else {
    errorEl.hidden = true;
  }

  // Result card
  if (state.result) {
    shortUrlEl.textContent = state.result.shortUrl;
    shortUrlEl.href = state.result.shortUrl;
    resultCard.hidden = false;
    // Animate on next frame
    requestAnimationFrame(() => resultCard.classList.add('visible'));
  } else {
    resultCard.classList.remove('visible');
    resultCard.hidden = true;
  }

  // History
  if (state.history.length === 0) {
    historyList.innerHTML = '';
    return;
  }
  historyList.innerHTML = state.history.map((item, i) => `
    <li class="history-item" data-index="${i}">
      <span class="orig" title="${item.longUrl}">${truncate(item.longUrl, 40)}</span>
      <a href="${item.shortUrl}" target="_blank" rel="noopener">${item.shortUrl}</a>
      <span class="ts">${formatTs(item.ts)}</span>
      <button class="hist-copy" data-url="${item.shortUrl}" title="Copy">⎘</button>
    </li>
  `).join('');
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max) + '…';
}

// ─── Event Handlers ───────────────────────────────────────────

async function handleShorten() {
  if (state.isLoading) return;
  state.isLoading = true;
  state.error = null;
  state.result = null;
  render();

  try {
    const shortUrl = await shortenUrl(state.inputValue);
    state.result = { shortUrl, longUrl: state.inputValue };
    addToHistory(shortUrl, state.inputValue);
    renderQR(shortUrl);
  } catch (err) {
    state.error = err.message || 'Shortening failed. Try again.';
  } finally {
    state.isLoading = false;
    render();
  }
}

async function handlePaste() {
  try {
    const text = await navigator.clipboard.readText();
    state.inputValue = text;
    state.error = null;
    render();
  } catch (_) {
    state.error = 'Paste blocked by browser, use Ctrl+V';
    render();
    setTimeout(() => { state.error = null; render(); }, 2000);
  }
}

// ─── Init ─────────────────────────────────────────────────────

function init() {
  loadHistory();
  render();

  document.getElementById('url-input').addEventListener('input', function () {
    state.inputValue = this.value;
    state.error = null;
    render();
  });

  document.getElementById('shorten-btn').addEventListener('click', handleShorten);
  document.getElementById('paste-btn').addEventListener('click', handlePaste);

  document.getElementById('copy-btn').addEventListener('click', function () {
    if (state.result) copyToClipboard(state.result.shortUrl, this, 'Copy');
  });

  document.getElementById('download-qr-btn').addEventListener('click', downloadQR);

  document.getElementById('clear-history-btn').addEventListener('click', () => {
    state.history = [];
    saveHistory();
    render();
  });

  // History copy buttons (delegated)
  document.getElementById('history-list').addEventListener('click', function (e) {
    const btn = e.target.closest('.hist-copy');
    if (btn) copyToClipboard(btn.dataset.url, btn, '⎘');
  });

  // Enter key to shorten
  document.getElementById('url-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !document.getElementById('shorten-btn').disabled) {
      handleShorten();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
