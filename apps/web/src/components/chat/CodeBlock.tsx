import React, { useMemo, useState } from "react";
import { Check, Copy, Maximize2 } from "lucide-react";
import { CodeViewer } from "./CodeViewer";

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "class", "extends", "new", "this", "super", "import", "from", "export", "default", "async", "await", "try", "catch", "finally",
  "throw", "interface", "type", "enum", "public", "private", "protected", "static", "final", "void", "int", "string", "boolean",
  "true", "false", "null", "undefined", "package", "fun", "val", "when", "object", "def", "lambda", "with", "as", "in", "is",
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "JOIN", "AND", "OR", "NOT", "NULL"
]);

function tokenClass(token: string, language: string) {
  if (/^\/\//.test(token) || /^\/\*/.test(token) || /^#(?![\w-]+$)/.test(token)) return "tok-comment";
  if (/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)$/.test(token)) return "tok-string";
  if (/^\d+(?:\.\d+)?$/.test(token)) return "tok-number";
  if (/^[+\-*\/=<>!&|?:%^~]+$/.test(token)) return "tok-operator";
  if (/^<\/?[A-Za-z][^>]*>$/.test(token)) return "tok-tag";
  if (KEYWORDS.has(token) || KEYWORDS.has(token.toUpperCase())) return "tok-keyword";
  if (/^[A-Za-z_$][\w$]*(?=\()/.test(token)) return "tok-function";
  if ((language === "css" || language === "scss") && /^[\w-]+(?=\s*:)/.test(token)) return "tok-property";
  return "";
}

function highlightLine(line: string, language: string, lineNumber: number) {
  const matcher = /(\/\*.*?\*\/|\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\/?[A-Za-z][^>]*>|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|[+\-*\/=<>!&|?:%^~]+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let part = 0;
  while ((match = matcher.exec(line))) {
    if (match.index > last) nodes.push(line.slice(last, match.index));
    const token = match[0];
    const cls = tokenClass(token, language);
    nodes.push(cls ? <span className={cls} key={`${lineNumber}-${part++}`}>{token}</span> : token);
    last = match.index + token.length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes;
}

function HighlightedCode({ code, language }: { code: string; language: string }) {
  return <>{code.split("\n").map((line, index) => <React.Fragment key={index}>{highlightLine(line, language, index)}{index < code.split("\n").length - 1 ? "\n" : ""}</React.Fragment>)}</>;
}

export function CodeBlock({ language, filename, code, complete = true }: { language: string; filename?: string; code: string; complete?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const highlighted = useMemo(() => <HighlightedCode code={code} language={language} />, [code, language]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <section className={`jazz-code-card ${complete ? "" : "is-streaming"}`}>
        <header className="jazz-code-card-header">
          <div className="jazz-code-title-group">
            <span className="jazz-code-language">{language.toUpperCase()}</span>
            <strong title={filename}>{filename || "Code"}</strong>
            {!complete && <em>Streaming…</em>}
          </div>
          <div className="jazz-code-actions">
            <button type="button" onClick={copyCode} aria-label="Copy this code block" title="Copy code">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" onClick={() => setExpanded(true)} aria-label="Expand this code block" title="Expand code">
              <Maximize2 size={15} />
              <span>Expand</span>
            </button>
          </div>
        </header>
        <pre className="jazz-code-body"><code>{highlighted}</code></pre>
      </section>
      <CodeViewer open={expanded} language={language} filename={filename} code={highlighted} copied={copied} onCopy={copyCode} onClose={() => setExpanded(false)} />
    </>
  );
}
