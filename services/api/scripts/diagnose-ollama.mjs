// Reproduce the precise Node.js fetch transport used by Jazz for Ollama.
// Read-only model inference, low token/context limits, no paid API or devices.
const url = String(process.argv[3] || process.env.JAZZ_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = process.argv[2] || "qwen3:4b";
const body = {
  model, think:false, stream:false, keep_alive:"1m",
  messages:[{role:"user",content:"In one short paragraph explain React.js and its components."}],
  options:{num_ctx:2048,num_predict:128}
};
try {
  const started = Date.now();
  const response = await fetch(url + "/api/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(240000)
  });
  if (!response.ok) {
    throw new Error("HTTP " + response.status + ": " + (await response.text()).slice(0,500));
  }
  const data = await response.json();
  const text = data?.message?.content?.trim() || "";
  if (!text) throw new Error("Local model returned no text");
  console.log("PASS: Node.js fetch generated text using " + model + " in " + Math.round((Date.now()-started)/1000) + " seconds.");
  console.log(text.slice(0,1300));
} catch (error) {
  console.error("FAIL: Node.js Ollama fetch failed for " + model + " at " + url);
  console.error("Error:",error?.name, error?.message);
  if(error?.cause) console.error("Underlying cause:",error.cause.code || "",error.cause.message || "");
  console.error("This is the same fetch transport used by Jazz PDF drafting.");
  process.exitCode = 1;
}
