function cleanMessage(message) {
  return String(message || "")
    .trim()
    .replace(/^(?:hey\s+)?jazz[,:\-\s]*/i, "")
    .trim();
}

const DOCUMENT_ACTION = /^(?:(?:hey\s+)?jazz[,!]?\s*)?(?:please\s+)?(?:create|generate|make|prepare|write|export|build)\b/i;
const DOCUMENT_TYPE = /\b(?:pdf|word|docx|excel|xlsx|spreadsheet)\b/i;
const SOFTWARE_TARGET = /\b(?:app(?:lication)?|website|webapp|web\s+app|software|api|component|script|package|library|pdf\s+generator)\b/i;

export function isDocumentCreationRequest(message) {
  const text = cleanMessage(message);
  // "Build a PDF generator application" is coding; "Create a PDF report
  // about React.js" is document generation. Avoid routing by topic keyword.
  // The topic of a report can itself be an app/API. Judge the requested
  // output before subject clauses, not keywords inside the document topic.
  const requestedOutput = text.split(/\b(?:about|on|regarding|covering|for)\b/i, 1)[0];
  return DOCUMENT_ACTION.test(text)
    && DOCUMENT_TYPE.test(requestedOutput.slice(0, 200))
    && !SOFTWARE_TARGET.test(requestedOutput.slice(0, 200));
}

const STRONG_PATTERNS = [
  /\b(create|build|generate|scaffold|make)\b.*\b(react|next\.?js|node\.?js|express|frontend|backend|full[- ]?stack|website|web app|application|api|dashboard|login page|todo|android|webview|typescript|javascript|java|c#|\.net)\b/i,
  /\b(fix|debug|repair|resolve)\b.*\b(error|errors|bug|bugs|build|test|tests|project|repository|repo|code)\b/i,
  /\b(run|execute)\b.*\b(test|tests|lint|linter|build|typecheck|type check)\b/i,
  /\b(explain|analy[sz]e|inspect|review)\b.*\b(repository|repo|project|codebase|code)\b/i,
  /\b(connect|integrate|wire)\b.*\b(react|frontend|page|component)\b.*\b(api|backend|endpoint)\b/i,
  /\b(add|implement)\b.*\b(authentication|auth|cart|checkout|api|route|component|feature|test|tests)\b/i
];

const NON_CODING = [
  /^open\s+/i,
  /^scroll\s+/i,
  /^call\s+/i,
  /^send\s+/i,
  /^remind\s+/i,
  /\binstagram\b/i,
  /\bwhatsapp\b/i,
  /\bflashlight\b/i,
  /\brecovery\s+(status|mode|location|camera)\b/i
];

export function detectCodingIntent(message) {
  const text = cleanMessage(message);
  if (!text) return { matched: false, confidence: 0, text };
  // Hard safety boundary: document/file creation is NOT a coding project,
  // even when the document topic is React, TypeScript, JavaScript or Android.
  // This guard lives inside the coding agent as defense in depth, independent
  // of which server entry point calls detectCodingIntent.
  if (isDocumentCreationRequest(text)) {
    return { matched: false, confidence: 0, text, kind: null, delegatedTo: "artifact-generation" };
  }
  if (NON_CODING.some(pattern => pattern.test(text)) && !/\b(create|build|fix|debug|code|project|app(?:lication)?)\b/i.test(text)) {
    return { matched: false, confidence: 0.02, text };
  }
  const matched = STRONG_PATTERNS.some(pattern => pattern.test(text));
  return {
    matched,
    confidence: matched ? 0.96 : 0.08,
    text,
    kind: matched ? classifyCodingRequest(text) : null
  };
}

export function classifyCodingRequest(text) {
  const value = String(text || "");
  if (/\b(explain|analy[sz]e|inspect|review)\b.*\b(repository|repo|project|codebase)\b/i.test(value)) return "explain_repository";
  if (/\b(run|execute)\b.*\b(test|tests)\b/i.test(value)) return "run_tests";
  if (/\b(fix|debug|repair|resolve)\b/i.test(value)) return "fix_project";
  if (/\b(create|build|generate|scaffold|make)\b/i.test(value)) return "create_project";
  return "modify_project";
}

export { cleanMessage };
