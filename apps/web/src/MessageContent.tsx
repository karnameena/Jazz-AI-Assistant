import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import "./message-content.css";

type Segment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; language: string };

function parseMessage(source: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([\w#+.-]*)\s*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(source)) !== null) {
    if (match.index > cursor) segments.push({ type: "text", value: source.slice(cursor, match.index) });
    segments.push({
      type: "code",
      language: (match[1] || "code").toLowerCase(),
      value: match[2].replace(/^\n|\n$/g, ""),
    });
    cursor = fence.lastIndex;
  }
  if (cursor < source.length) segments.push({ type: "text", value: source.slice(cursor) });
  return segments.length ? segments : [{ type: "text", value: source }];
}

function InlineText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="jazz-rich-text">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div className="jazz-rich-space" key={index} />;
        const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
        if (heading) return <strong className={`jazz-rich-heading h${heading[1].length}`} key={index}>{heading[2]}</strong>;
        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        if (bullet) return <div className="jazz-rich-bullet" key={index}><span>•</span><span>{renderInline(bullet[1])}</span></div>;
        return <div className="jazz-rich-line" key={index}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code className="jazz-inline-code" key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="jazz-code-card">
      <div className="jazz-code-toolbar">
        <div className="jazz-code-title"><span className="jazz-code-dots"><i /><i /><i /></span><span>{language}</span></div>
        <button className={copied ? "copied" : ""} onClick={() => void copy()} title="Copy code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className={`jazz-code language-${language}`}><code>{code}</code></pre>
    </div>
  );
}

export function MessageContent({ text }: { text: string }) {
  if (!text) return <span className="streaming-cursor">▌</span>;
  return (
    <div className="jazz-message-content">
      {parseMessage(text).map((segment, index) =>
        segment.type === "code"
          ? <CodeBlock key={index} language={segment.language} code={segment.value} />
          : <InlineText key={index} text={segment.value} />,
      )}
    </div>
  );
}
