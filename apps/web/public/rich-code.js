(() => {
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  let scanTimer = 0;

  const languages = {
    py: ['Python', 'python'], python: ['Python', 'python'],
    js: ['JavaScript', 'javascript'], javascript: ['JavaScript', 'javascript'],
    jsx: ['JSX', 'javascript'], ts: ['TypeScript', 'typescript'], typescript: ['TypeScript', 'typescript'], tsx: ['TSX', 'typescript'],
    json: ['JSON', 'json'], html: ['HTML', 'html'], xml: ['XML', 'html'],
    css: ['CSS', 'css'], scss: ['SCSS', 'css'],
    sh: ['Shell', 'shell'], bash: ['Bash', 'shell'], shell: ['Shell', 'shell'],
    ps1: ['PowerShell', 'powershell'], powershell: ['PowerShell', 'powershell'],
    java: ['Java', 'java'], c: ['C', 'c'], cpp: ['C++', 'cpp'], 'c++': ['C++', 'cpp'],
    cs: ['C#', 'csharp'], 'c#': ['C#', 'csharp'], sql: ['SQL', 'sql'],
    text: ['Text', 'text'], txt: ['Text', 'text']
  };

  const keywordSets = {
    python: new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case'.split(' ')),
    javascript: new Set('async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield'.split(' ')),
    typescript: new Set('abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let namespace never new null number object of override private protected public readonly return set static string super switch symbol this throw true try type typeof undefined unknown var void while with yield'.split(' ')),
    powershell: new Set('begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using var while'.split(' ')),
    shell: new Set('case do done elif else esac fi for function if in select then until while time coproc'.split(' ')),
    java: new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null'.split(' ')),
    c: new Set('auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while'.split(' ')),
    cpp: new Set('alignas alignof and asm auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern false float for friend if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'.split(' ')),
    csharp: new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var'.split(' ')),
    sql: new Set('select from where join inner left right full on as and or not null insert into values update set delete create table alter drop group by order having limit distinct union all case when then else end'.split(' '))
  };

  const builtinSets = {
    python: new Set('print len range str int float list dict set tuple bool open input sum min max enumerate zip map filter isinstance super self requests'.split(' ')),
    javascript: new Set('console Math JSON Object Array String Number Boolean Promise Date Map Set fetch window document navigator localStorage'.split(' ')),
    typescript: new Set('console Math JSON Object Array String Number Boolean Promise Date Map Set fetch window document navigator localStorage'.split(' ')),
    powershell: new Set('Write-Host Write-Output Get-Item Get-ChildItem Set-Location Test-Path Start-Process Stop-Process Invoke-RestMethod Invoke-WebRequest'.split(' '))
  };

  function normalizeLanguage(raw) {
    const key = String(raw || '').trim().toLowerCase();
    const match = languages[key] || [key || 'Code', key || 'text'];
    return { label: match[0], key: match[1] };
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tokenClass(token, lang) {
    if (/^(?:\/\/|#|\/\*)/.test(token)) return 'comment';
    if (/^["'`]/.test(token)) return 'string';
    if (/^\d/.test(token)) return 'number';
    if (keywordSets[lang]?.has(token)) return 'keyword';
    if (builtinSets[lang]?.has(token)) return 'builtin';
    return '';
  }

  function highlightGeneric(code, lang) {
    const tokenPattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$-]*\b)/g;
    let out = '';
    let last = 0;
    for (const match of code.matchAll(tokenPattern)) {
      const index = match.index ?? 0;
      out += escapeHtml(code.slice(last, index));
      const token = match[0];
      const cls = tokenClass(token, lang);
      out += cls ? `<span class="jz-syn-${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
      last = index + token.length;
    }
    out += escapeHtml(code.slice(last));
    return out;
  }

  function highlightHtml(code) {
    return escapeHtml(code)
      .replace(/(&lt;\/?)([A-Za-z][\w:-]*)/g, '$1<span class="jz-syn-tag">$2</span>')
      .replace(/\s([A-Za-z_:][-\w:.]*)(=)/g, ' <span class="jz-syn-attr">$1</span>$2')
      .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="jz-syn-string">$1</span>');
  }

  function highlight(code, lang) {
    if (lang === 'html') return highlightHtml(code);
    return highlightGeneric(code, lang);
  }

  function parseFences(source) {
    const parts = [];
    const regex = /```\s*([\w+#.-]*)[^\S\r\n]*(?:\r?\n)?([\s\S]*?)```/g;
    let last = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
      parts.push({ type: 'code', language: match[1] || '', value: match[2].replace(/^\s*\r?\n/, '').replace(/\s+$/, '') });
      last = regex.lastIndex;
    }
    if (!parts.some(part => part.type === 'code')) return null;
    if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
    return parts;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
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
    button.setAttribute('aria-label', 'Copy code');
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
        }, 1400);
      } catch {
        button.querySelector('span').textContent = 'Copy failed';
        window.setTimeout(() => { button.innerHTML = `${COPY_ICON}<span>Copy code</span>`; }, 1400);
      }
    });
    return button;
  }

  function renderCodeCard(code, language) {
    const lang = normalizeLanguage(language);
    const card = document.createElement('section');
    card.className = `jazz-code-card jazz-${lang.key}`;

    const header = document.createElement('div');
    header.className = 'jazz-code-header';

    const label = document.createElement('span');
    label.className = 'jazz-code-language';
    label.textContent = lang.label;

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.innerHTML = highlight(code, lang.key);
    pre.appendChild(codeEl);

    header.append(label, makeCopyButton(code));
    card.append(header, pre);
    return card;
  }

  function appendInlineMarkdown(container, line) {
    const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
    let last = 0;
    for (const match of line.matchAll(regex)) {
      const index = match.index ?? 0;
      if (index > last) container.append(document.createTextNode(line.slice(last, index)));
      const token = match[0];
      const element = document.createElement(token.startsWith('`') ? 'code' : 'strong');
      element.className = token.startsWith('`') ? 'jazz-inline-code' : '';
      element.textContent = token.startsWith('`') ? token.slice(1, -1) : token.slice(2, -2);
      container.append(element);
      last = index + token.length;
    }
    if (last < line.length) container.append(document.createTextNode(line.slice(last)));
  }

  function renderProse(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'jazz-rich-prose';
    const normalized = String(text || '').trim();
    if (!normalized) return wrapper;

    for (const rawLine of normalized.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        const spacer = document.createElement('div');
        spacer.className = 'jazz-prose-spacer';
        wrapper.appendChild(spacer);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const row = document.createElement('div');
        row.className = 'jazz-prose-list-item';
        const bullet = document.createElement('span');
        bullet.textContent = '•';
        const copy = document.createElement('span');
        appendInlineMarkdown(copy, line.replace(/^[-*]\s+/, ''));
        row.append(bullet, copy);
        wrapper.appendChild(row);
        continue;
      }

      const paragraph = document.createElement('div');
      paragraph.className = 'jazz-prose-line';
      appendInlineMarkdown(paragraph, line);
      wrapper.appendChild(paragraph);
    }
    return wrapper;
  }

  function renderRichMessage(target) {
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.jazzRichSource === target.textContent && target.querySelector('.jazz-code-card')) return;

    const source = target.textContent || '';
    if (!source.includes('```')) return;
    const parts = parseFences(source);
    if (!parts) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'jazz-rich-message';
    for (const part of parts) {
      if (part.type === 'code') wrapper.appendChild(renderCodeCard(part.value, part.language));
      else if (part.value.trim()) wrapper.appendChild(renderProse(part.value));
    }

    target.dataset.jazzRichSource = source;
    target.replaceChildren(wrapper);
  }

  function scan() {
    document.querySelectorAll('.jazz-bubble > div').forEach(renderRichMessage);
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 120);
  }

  const observer = new MutationObserver(scheduleScan);
  function start() {
    scan();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
