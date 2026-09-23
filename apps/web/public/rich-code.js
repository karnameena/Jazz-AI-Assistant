(() => {
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  const STABLE_MS = 650;
  const SCAN_MS = 450;
  const MAX_SOURCE = 50000;
  const seen = new WeakMap();
  let scanTimer = 0;

  const languages = {
    py: ['Python', 'python'], python: ['Python', 'python'],
    js: ['JavaScript', 'javascript'], javascript: ['JavaScript', 'javascript'], jsx: ['JSX', 'javascript'],
    ts: ['TypeScript', 'typescript'], typescript: ['TypeScript', 'typescript'], tsx: ['TSX', 'typescript'],
    json: ['JSON', 'json'], html: ['HTML', 'html'], xml: ['XML', 'html'], css: ['CSS', 'css'], scss: ['SCSS', 'css'],
    sh: ['Shell', 'shell'], bash: ['Bash', 'shell'], shell: ['Shell', 'shell'],
    ps1: ['PowerShell', 'powershell'], powershell: ['PowerShell', 'powershell'],
    java: ['Java', 'java'], c: ['C', 'c'], cpp: ['C++', 'cpp'], cs: ['C#', 'csharp'], sql: ['SQL', 'sql'],
    text: ['Text', 'text'], txt: ['Text', 'text']
  };

  function normalizeLanguage(raw) {
    const key = String(raw || '').trim().toLowerCase();
    const match = languages[key] || [key || 'Code', key || 'text'];
    return { label: match[0], key: match[1] };
  }

  function normalizeCodeText(value) {
    let code = String(value || '');
    if (!code.includes('\n') && /\\n/.test(code)) code = code.replace(/\\n/g, '\n');
    if (/\\t/.test(code)) code = code.replace(/\\t/g, '\t');
    return code.replace(/^\s*\r?\n/, '').replace(/\s+$/, '');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function highlight(code, lang) {
    const escaped = escapeHtml(code);
    if (lang === 'html') {
      return escaped
        .replace(/(&lt;\/?)([A-Za-z][\w:-]*)/g, '$1<span class="jz-syn-tag">$2</span>')
        .replace(/\s([A-Za-z_:][-\w:.]*)(=)/g, ' <span class="jz-syn-attr">$1</span>$2');
    }
    return escaped
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g, '<span class="jz-syn-string">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="jz-syn-number">$1</span>');
  }

  function parseFences(source) {
    const parts = [];
    const regex = /```\s*([\w+#.-]*)[^\S\r\n]*(?:\r?\n)?([\s\S]*?)```/g;
    let last = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
      parts.push({ type: 'code', language: match[1] || '', value: normalizeCodeText(match[2]) });
      last = regex.lastIndex;
    }
    if (!parts.some(part => part.type === 'code')) return null;
    if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
    return parts;
  }

  function detectBareCode(source) {
    const text = normalizeCodeText(source).trim();
    if (!text || text.length < 8) return null;
    if (/^(?:from\s+\S+\s+import\s+|import\s+\S+|def\s+\w+\s*\(|class\s+\w+\b)/.test(text)) return { language: 'python', code: text };
    if (/^(?:const|let|var|function|async\s+function|import|export)\b/.test(text)) return { language: 'javascript', code: text };
    if (/^(?:param\s*\(|\$[A-Za-z_]|Get-|Set-|Invoke-|Write-|Start-|Stop-)/i.test(text)) return { language: 'powershell', code: text };
    if (/^(?:#!\/|sudo\s+|apt\s+|npm\s+|pnpm\s+|git\s+|adb\s+)/.test(text)) return { language: 'shell', code: text };
    return null;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function makeCopyButton(code) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'jazz-copy-code';
    button.innerHTML = `${COPY_ICON}<span>Copy code</span>`;
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await copyText(code);
        button.classList.add('copied');
        button.innerHTML = `${CHECK_ICON}<span>Copied</span>`;
        window.setTimeout(() => {
          button.classList.remove('copied');
          button.innerHTML = `${COPY_ICON}<span>Copy code</span>`;
        }, 1200);
      } catch {
        button.textContent = 'Copy failed';
      }
    });
    return button;
  }

  function renderCodeCard(code, language) {
    const lang = normalizeLanguage(language);
    const normalized = normalizeCodeText(code);
    const card = document.createElement('section');
    card.className = `jazz-code-card jazz-${lang.key}`;
    const header = document.createElement('div');
    header.className = 'jazz-code-header';
    const label = document.createElement('span');
    label.className = 'jazz-code-language';
    label.textContent = lang.label;
    header.append(label, makeCopyButton(normalized));
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.innerHTML = highlight(normalized, lang.key);
    pre.appendChild(codeEl);
    card.append(header, pre);
    return card;
  }

  function renderProse(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'jazz-rich-prose';
    const normalized = String(text || '').trim();
    if (!normalized) return wrapper;
    for (const rawLine of normalized.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      const row = document.createElement('div');
      row.className = /^[-*]\s+/.test(line) ? 'jazz-prose-list-item' : 'jazz-prose-line';
      row.textContent = /^[-*]\s+/.test(line) ? `• ${line.replace(/^[-*]\s+/, '')}` : line;
      wrapper.appendChild(row);
    }
    return wrapper;
  }

  function renderStableTarget(target, source) {
    const parts = source.includes('```') ? parseFences(source) : null;
    const bare = !parts ? detectBareCode(source) : null;
    if (!parts && !bare) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'jazz-rich-message';
    if (parts) {
      for (const part of parts) {
        if (part.type === 'code') wrapper.appendChild(renderCodeCard(part.value, part.language));
        else if (part.value.trim()) wrapper.appendChild(renderProse(part.value));
      }
    } else if (bare) {
      wrapper.appendChild(renderCodeCard(bare.code, bare.language));
    }

    target.dataset.jazzRichSource = source.slice(0, 2000);
    target.replaceChildren(wrapper);
  }

  function scan() {
    scanTimer = 0;
    if (document.hidden) return;
    const now = performance.now();
    const targets = document.querySelectorAll('.jazz-bubble > div:first-child');
    for (const target of targets) {
      if (!(target instanceof HTMLElement)) continue;
      if (target.querySelector('.jazz-rich-message')) continue;
      const source = String(target.textContent || '');
      if (!source || source.length > MAX_SOURCE || source.includes('▌')) continue;

      const previous = seen.get(target);
      if (!previous || previous.text !== source) {
        seen.set(target, { text: source, since: now });
        continue;
      }
      if (now - previous.since < STABLE_MS) continue;
      renderStableTarget(target, source);
    }
  }

  function scheduleScan(delay = SCAN_MS) {
    if (scanTimer) return;
    scanTimer = window.setTimeout(scan, delay);
  }

  // Deliberately avoid a document-wide MutationObserver. React/Ollama can update
  // chat text many times per second; observing every character made the whole page
  // contend with syntax rendering. A low-frequency stable-message scan is enough.
  const interval = window.setInterval(() => scheduleScan(0), SCAN_MS);
  window.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(0); });
  window.addEventListener('beforeunload', () => window.clearInterval(interval), { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scheduleScan(0), { once: true });
  else scheduleScan(0);
})();
