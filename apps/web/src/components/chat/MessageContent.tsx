import React from "react";
import { parseMessageContent } from "../../utils/parseCodeBlocks";
import { CodeBlock } from "./CodeBlock";
import "./code-block.css";

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return <>{parts.map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code className="jazz-inline-code" key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  })}</>;
}

export function MessageContent({ text }: { text: string }) {
  if (!text) return <span className="streaming-cursor">▌</span>;

  // Parsing is inexpensive and keeping this renderer hook-free prevents a stray
  // dev-runtime hook mismatch from blanking the complete Jazz chat surface.
  const segments = parseMessageContent(text);

  return (
    <div className="jazz-message-content">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return <CodeBlock key={`code-${index}`} language={segment.language} filename={segment.filename} code={segment.content} complete={segment.complete} />;
        }
        if (segment.type === "heading") {
          const Tag = (`h${Math.min(6, Math.max(2, segment.level + 1))}`) as keyof JSX.IntrinsicElements;
          return <Tag className="jazz-message-heading" key={`heading-${index}`}><InlineText text={segment.content} /></Tag>;
        }
        const blocks = segment.content.split(/\n{2,}/).filter(Boolean);
        return <React.Fragment key={`text-${index}`}>{blocks.map((block, blockIndex) => {
          const lines = block.split("\n");
          const isTree = lines.length > 1 && lines.some(line => /[├└│]──|^\s*[\w.-]+\/$/.test(line));
          if (isTree) return <pre className="jazz-project-tree" key={blockIndex}>{block}</pre>;
          return <p className="jazz-message-paragraph" key={blockIndex}>{lines.map((line, lineIndex) => <React.Fragment key={lineIndex}><InlineText text={line} />{lineIndex < lines.length - 1 && <br />}</React.Fragment>)}</p>;
        })}</React.Fragment>;
      })}
    </div>
  );
}
