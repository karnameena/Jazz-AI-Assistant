// Keep generated prose separate from reminder/tool output. Never rewrite fenced code.
export function sanitizeJazzReply(text) {
  let inCode = false, skipReminder = false;
  const seen = new Set();
  const lines = String(text || "").split("\n");
  return lines.flatMap(line => {
    if (/^\s*```/.test(line)) {inCode = !inCode; return [line];}
    if (inCode) return [line];
    if (/^\s*\[(?:sound|noise|music|silence|blank audio|inaudible)\]\s*$/i.test(line)) return [];
    if (/^\s*(?:P\s*\.\s*)+S\s*\./i.test(line)) return [];
    if (/^\s*[⏰⏱✅✓]*\s*(?:Mama,\s*time for:|Finished .+?Tap Done|Mama, reminder:)/i.test(line) || /Tap Done,?\s*(?:or|and) Snooze/i.test(line)) {skipReminder = true; return [];}
    if (line.trim() && seen.has(line.trim())) return [];
    if (line.trim()) seen.add(line.trim());
    if (!line.trim()) {skipReminder = false; return [line];}
    if (skipReminder) return [];
    return [line.replace(/(?:^|\s)(?:P\s*\.\s*)+S\s*\.[\s\S]*$/i, "").replace(/(?:^|\s)I (?:will|shall) be available for any other tasks you have in the future[.!]*/i, "")];
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
