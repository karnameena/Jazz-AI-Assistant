export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "code"; language: string; filename?: string; content: string; complete: boolean };

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  js: "javascript", jsx: "jsx", ts: "typescript", tsx: "tsx",
  html: "html", htm: "html", css: "css", scss: "scss",
  json: "json", py: "python", java: "java", kt: "kotlin",
  kts: "kotlin", sql: "sql", sh: "bash", bash: "bash",
  ps1: "powershell", yml: "yaml", yaml: "yaml", xml: "xml",
  md: "markdown"
};

export function normalizeLanguage(value = "") {
  const raw = value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    js: "javascript", javascript: "javascript", jsx: "jsx",
    ts: "typescript", typescript: "typescript", tsx: "tsx",
    py: "python", python: "python", java: "java", kotlin: "kotlin",
    kt: "kotlin", shell: "bash", sh: "bash", bash: "bash",
    powershell: "powershell", ps1: "powershell", yml: "yaml",
    yaml: "yaml", html: "html", css: "css", scss: "scss",
    json: "json", sql: "sql", xml: "xml", md: "markdown",
    markdown: "markdown"
  };
  return aliases[raw] || raw || "text";
}

export function languageFromFilename(filename?: string) {
  if (!filename) return "text";
  const clean = filename.replace(/[)`]/g, "").trim();
  const ext = clean.split(".").pop()?.toLowerCase() || "";
  return EXTENSION_TO_LANGUAGE[ext] || "text";
}

function cleanHeadingFilename(content: string) {
  const trimmed = content.trim();
  const tick = trimmed.match(/^`([^`]+)`$/);
  const value = tick ? tick[1] : trimmed;
  return /(?:^|\/)[^/]+\.[a-z0-9]+$/i.test(value) ? value : undefined;
}

export function parseMessageContent(input: string): MessageSegment[] {
  const text = String(input || "").replace(/\r\n/g, "\n");
  if (!text) return [];

  const result: MessageSegment[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let pendingFilename: string | undefined;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    result.push({ type: "text", content: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const content = heading[2].trim();
      result.push({ type: "heading", level: heading[1].length, content });
      pendingFilename = cleanHeadingFilename(content);
      continue;
    }

    const fence = line.match(/^```\s*([^\s`]*)\s*(.*)$/);
    if (fence) {
      flushParagraph();
      const infoLanguage = normalizeLanguage(fence[1]);
      const infoFilename = fence[2]?.trim() || undefined;
      const code: string[] = [];
      let complete = false;
      i += 1;
      for (; i < lines.length; i += 1) {
        if (/^```\s*$/.test(lines[i])) { complete = true; break; }
        code.push(lines[i]);
      }
      const filename = infoFilename || pendingFilename;
      const language = infoLanguage !== "text" ? infoLanguage : languageFromFilename(filename);
      result.push({ type: "code", language, filename, content: code.join("\n"), complete });
      pendingFilename = undefined;
      continue;
    }

    paragraph.push(line);
    if (line.trim()) pendingFilename = undefined;
  }

  flushParagraph();
  return result;
}
