(() => {
  const JAZZ_API_BASE = "http://127.0.0.1:8797";
  const nativeFetch = window.fetch.bind(window);

  const resolveTarget = input => {
    if (typeof input === "string" && input.startsWith("/api/")) return `${JAZZ_API_BASE}${input}`;
    if (input instanceof URL && input.pathname.startsWith("/api/") && input.origin === window.location.origin) {
      return new URL(`${JAZZ_API_BASE}${input.pathname}${input.search}`);
    }
    if (input instanceof Request) {
      const url = new URL(input.url, window.location.href);
      if (url.pathname.startsWith("/api/") && url.origin === window.location.origin) {
        return new Request(`${JAZZ_API_BASE}${url.pathname}${url.search}`, input);
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
      if (url === `${JAZZ_API_BASE}/api/chat`) {
        return new Response(JSON.stringify({
          ok: true,
          assistant: "Jazz API on port 8797 is not running. Start Jazz with start-jazz.ps1 and try again.",
          mode: "api-unreachable"
        }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
      }
      throw error;
    }
  };

  window.__JAZZ_API_BASE__ = JAZZ_API_BASE;
  console.info(`[Jazz] API router active: ${JAZZ_API_BASE}`);
})();
