const SECRET_KEYS = /token|password|secret|authorization|api[-_]?key|credential/i;

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[REDACTED]" : redact(v)]));
  return value;
}

export function createLogger(scope = "jazz") {
  const write = (level, event, data = {}) => {
    const entry = { timestamp: new Date().toISOString(), level, scope, event, ...redact(data) };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line); else if (level === "warn") console.warn(line); else console.log(line);
    return entry;
  };
  return {
    debug: (event, data) => write("debug", event, data),
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data)
  };
}
