const JAZZ_API_BASE = window.location.origin;
const nativeFetch = window.fetch.bind(window);

function resolveJazzApiTarget(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return input;
  }

  if (input instanceof URL && input.pathname.startsWith("/api/") && input.origin === window.location.origin) {
    return new URL(`${window.location.origin}${input.pathname}${input.search}`);
  }

  if (input instanceof Request) {
    const url = new URL(input.url, window.location.href);
    if (url.pathname.startsWith("/api/") && url.origin === window.location.origin) {
      return new Request(`${window.location.origin}${url.pathname}${url.search}`, input);
    }
  }

  return input;
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const target = resolveJazzApiTarget(input);

  try {
    return await nativeFetch(target, init);
  } catch (error) {
    const url = typeof target === "string"
      ? target
      : target instanceof Request
        ? target.url
        : target.toString();

    const resolvedUrl = new URL(url, window.location.href).toString();
    const chatUrl = new URL("/api/chat", window.location.origin).toString();

    if (resolvedUrl === chatUrl) {
      return new Response(JSON.stringify({
        ok: true,
        assistant: "Jazz API is not reachable through the web server. Start Jazz with start-jazz.ps1 and try again.",
        mode: "api-unreachable"
      }), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    throw error;
  }
};

Object.defineProperty(window, "__JAZZ_API_BASE__", {
  value: JAZZ_API_BASE,
  configurable: false,
  writable: false
});

console.info(`[Jazz] LAN-safe API runtime using ${JAZZ_API_BASE}`);
