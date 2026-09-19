(() => {
  const JAZZ_API_BASE = window.location.origin;
  const nativeFetch = window.fetch.bind(window);

  const resolveTarget = input => {
    if (typeof input === "string" && input.startsWith("/api/")) return input;
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
  };

  window.fetch = async (input, init) => {
    const target = resolveTarget(input);
    try {
      return await nativeFetch(target, init);
    } catch (error) {
      const url = typeof target === "string" ? target : target instanceof Request ? target.url : target.toString();
      const chatUrl = new URL("/api/chat", window.location.origin).toString();
      const resolvedUrl = new URL(url, window.location.href).toString();
      if (resolvedUrl === chatUrl) {
        return new Response(JSON.stringify({
          ok: true,
          assistant: "Jazz API is not reachable through the web server. Start Jazz with start-jazz.ps1 and try again.",
          mode: "api-unreachable"
        }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
      }
      throw error;
    }
  };

  window.__JAZZ_API_BASE__ = JAZZ_API_BASE;
  console.info(`[Jazz] LAN-safe API router active through ${JAZZ_API_BASE}`);
})();
