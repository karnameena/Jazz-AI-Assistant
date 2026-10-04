// Keep generated prose separate from reminder/tool output. Never rewrite fenced code.
export function sanitizeJazzReply(text) {
  let inCode = false, skipReminder = false;
  const lines = String(text || "").split("\n");
  return lines.filter(line => {
    if (/^\s*```/.test(line)) {inCode = !inCode; return true;}
    if (inCode) return true;
    if (/^\s*(?:P\s*\.\s*)+S\s*\./i.test(line)) return false;
    if (/^\s*[⏰⏱✅✓]*\s*(?:Mama,\s*time for:|Finished .+?Tap Done|Mama, reminder:)/i.test(line) || /Tap Done,?\s*(?:or|and) Snooze/i.test(line)) {skipReminder = true; return false;}
    if (!line.trim()) {skipReminder = false; return true;}
    return !skipReminder;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
