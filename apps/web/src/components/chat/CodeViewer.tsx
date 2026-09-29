import React, { useEffect } from "react";
import { Check, Copy, X } from "lucide-react";

export function CodeViewer({
  open,
  language,
  filename,
  code,
  copied,
  onCopy,
  onClose
}: {
  open: boolean;
  language: string;
  filename?: string;
  code: React.ReactNode;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="jazz-code-modal" role="dialog" aria-modal="true" aria-label={`${filename || language} code viewer`} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="jazz-code-modal-panel">
        <header className="jazz-code-modal-header">
          <div className="jazz-code-title-group">
            <span className="jazz-code-language">{language.toUpperCase()}</span>
            <strong title={filename}>{filename || "Code"}</strong>
          </div>
          <div className="jazz-code-actions">
            <button type="button" onClick={onCopy} aria-label="Copy code" title="Copy code">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" onClick={onClose} aria-label="Close code viewer" title="Close code viewer">
              <X size={17} />
              <span>Close</span>
            </button>
          </div>
        </header>
        <pre className="jazz-code-modal-body"><code>{code}</code></pre>
      </section>
    </div>
  );
}
