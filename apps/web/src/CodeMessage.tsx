import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Maximize2, X } from "lucide-react";

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; language: string; filename?: string };

const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", jsx: "JSX",
  ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  css: "CSS", scss: "SCSS", html: "HTML", json: "JSON",
  bash: "Bash", sh: "Shell", powershell: "PowerShell", ps1: "PowerShell",
  py: "Python", python: "Python", java: "Java", kotlin: "Kotlin",
  sql: "SQL", yaml: "YAML", yml: "YAML", xml: "XML", md: "Markdown"
};

function parseMessage(text: string): Segment[] {
  const parts: Segment[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text))) {
    if (match.index > cursor) parts.push({ type: "text", value: text.slice(cursor, match.index) });
    const info = match[1].trim();
    const tokens = info.split(/\s+/).filter(Boolean);
    const language = (tokens.shift() || "text").toLowerCase();
    const filenameToken = tokens.find(token => /^(?:file(?:name)?=)/i.test(token));
    const explicitFilename = filenameToken?.replace(/^(?:file(?:name)?=)/i, "").replace(/^["']|["']$/g, "");
    const before = text.slice(0, match.index);
    const heading = before.match(/(?:^|\n)#{1,6}\s+`?([^\n`]+\.[a-z0-9]+)`?\s*$/i);
    parts.push({ type: "code", value: match[2].replace(/\n$/, ""), language, filename: explicitFilename || heading?.[1]?.trim() });
    cursor = fence.lastIndex;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value: text }];
}

function RichText({ value }: { value: string }) {
  const lines = value.split("\n");
  return <div className="jazz-rich-text">{lines.map((line, index) => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return <strong className="jazz-rich-heading" key={index}>{heading[2].replace(/`/g, "")}</strong>;
    if (!line.trim()) return <span className="jazz-rich-spacer" key={index} />;
    return <span key={index}>{line}</span>;
  })}</div>;
}

function CodeBlock({ code, language, filename }: { code: string; language: string; filename?: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const label = LANGUAGE_LABELS[language] || language.toUpperCase() || "CODE";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [expanded]);

  const card = <div className={`jazz-code-card ${expanded ? "is-expanded" : ""}`}>
    <div className="jazz-code-toolbar">
      <div className="jazz-code-meta"><span className={`jazz-code-language lang-${language}`}>{label}</span>{filename && <span className="jazz-code-filename">{filename}</span>}</div>
      <div className="jazz-code-actions">
        <button type="button" onClick={copy} title="Copy code">{copied ? <Check size={15} /> : <Copy size={15} />}<span>{copied ? "Copied" : "Copy"}</span></button>
        <button type="button" onClick={() => setExpanded(value => !value)} title={expanded ? "Close" : "Expand"}>{expanded ? <X size={16} /> : <Maximize2 size={15} />}</button>
      </div>
    </div>
    <div className="jazz-code-scroll"><pre><code>{code}</code></pre></div>
  </div>;

  return expanded ? <div className="jazz-code-modal" role="dialog" aria-modal="true">{card}</div> : card;
}

export function CodeMessage({ text }: { text: string }) {
  const segments = useMemo(() => parseMessage(text), [text]);
  return <div className="jazz-message-content">{segments.map((segment, index) =>
    segment.type === "code"
      ? <CodeBlock key={index} code={segment.value} language={segment.language} filename={segment.filename} />
      : <RichText key={index} value={segment.value} />
  )}</div>;
}
