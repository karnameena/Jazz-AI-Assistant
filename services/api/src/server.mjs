import http from "node:http";

const port = Number(process.env.PORT || 8787);

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET" && req.url === "/health") {
    res.end(JSON.stringify({ ok: true, service: "jazz-api" }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const input = JSON.parse(body || "{}");
        const message = typeof input.message === "string" ? input.message : "";
        res.end(JSON.stringify({
          ok: true,
          assistant: `Jazz received: ${message}`,
          mode: "scaffold"
        }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: "Not found" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Jazz API listening on :${port}`);
});
