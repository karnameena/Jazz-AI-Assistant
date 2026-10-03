import React from "react";
import { Check, Copy, X } from "lucide-react";

type CodeViewerProps = {
  open: boolean;
  language: string;
  filename?: string;
  code: React.ReactNode;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
};

/**
 * Class-based to keep the code modal independent from hook-dispatcher state.
 * This prevents a dev-runtime hook mismatch from taking down the whole Jazz UI.
 */
export class CodeViewer extends React.PureComponent<CodeViewerProps> {
  private previousBodyOverflow: string | null = null;

  componentDidMount() {
    if (this.props.open) this.attachModalEffects();
  }

  componentDidUpdate(prevProps: CodeViewerProps) {
    if (!prevProps.open && this.props.open) this.attachModalEffects();
    if (prevProps.open && !this.props.open) this.detachModalEffects();
  }

  componentWillUnmount() {
    this.detachModalEffects();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.props.onClose();
  };

  private attachModalEffects() {
    if (this.previousBodyOverflow == null) {
      this.previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    window.addEventListener("keydown", this.onKeyDown);
  }

  private detachModalEffects() {
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.previousBodyOverflow != null) {
      document.body.style.overflow = this.previousBodyOverflow;
      this.previousBodyOverflow = null;
    }
  }

  render() {
    const { open, language, filename, code, copied, onCopy, onClose } = this.props;
    if (!open) return null;

    return (
      <div
        className="jazz-code-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${filename || language} code viewer`}
        onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
      >
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
}
