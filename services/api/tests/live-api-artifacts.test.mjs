// Exercises the real Node API, chat, streaming chat and artifact downloads.
// Mock Ollama stays on loopback and does not install/download any model.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("live Jazz chat and streaming deliver real PDF/Excel, never the coding agent", {timeout: 85000}, async () => {
  let simulatedRunnerCrashes = 0;
  let fallbackModelsUsed = 0;
  const mockOllama = http.createServer(async (req, res) => {
    let result;
    if (req.url === "/api/tags") result = {models:[{name:"qwen3:1.7b"},{name:"qwen3:0.6b"}]};
    else if (req.url === "/api/generate") result = {response:"",done:true};
    else if (req.url === "/api/chat") {
      let content = "";
      for await (const chunk of req) content += String(chunk);
      const body = JSON.parse(content);
      if (body.model === "qwen3:1.7b" && simulatedRunnerCrashes === 0) {
        simulatedRunnerCrashes += 1;
        req.socket.destroy(); // Simulate Windows Ollama runner dying under RAM pressure
        return;
      }
      if (body.model === "qwen3:0.6b") fallbackModelsUsed += 1;
      result = {message:{role:"assistant",content:
        "# Executive Summary\nReact.js builds user interfaces using components.\n\n" +
        "## Core Concepts\nReact offers components, props, state and hooks.\n\n" +
        "## Conclusion\nUse accessibility, testing and good state boundaries."}, done:true};
    } else {res.writeHead(404);res.end("Not found");return;}
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify(result));
  });
  const modelPort = await listen(mockOllama);
  const isolatedStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "jazz-artifacts-e2e-"));
  let child;
  let logs = "";
  try {
    const temporaryServer = http.createServer();
    const apiPort = await listen(temporaryServer);
    await new Promise(resolve => temporaryServer.close(resolve));
    child = spawn(process.execPath, [path.join(root, "services/api/src/server.mjs")], {
      cwd:isolatedStateDir,
      windowsHide:true,
      stdio:["ignore","pipe","pipe"],
      env:{
        ...process.env,
        PORT:String(apiPort),
        JAZZ_OLLAMA_URL:"http://127.0.0.1:" + modelPort,
        JAZZ_OLLAMA_AUTOSTART:"false",
        JAZZ_FREE_ONLY:"true",
        JAZZ_DOCUMENT_MODEL:"qwen3:1.7b",
        JAZZ_NORMAL_MODEL:"qwen3:1.7b",
        JAZZ_WEB_RAG_ENABLED:"false",
        JAZZWHATSAPP_ALLOW_SIGNUP:"true"
      }
    });
    const capture = chunk => {logs = (logs + chunk.toString()).slice(-10000);};
    child.stdout.on("data",capture);
    child.stderr.on("data",capture);
    const url = "http://127.0.0.1:" + apiPort;
    let ready = false;
    for (let i = 0; i < 160; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(url + "/api/routing/health", {signal:AbortSignal.timeout(650)});
        if (response.ok) {ready=true;break;}
      } catch {}
      await delay(150);
    }
    assert.equal(ready,true,"Jazz API did not become ready: " + logs);
    const health = await (await fetch(url + "/api/routing/health")).json();
    assert.equal(health.samples["Create a professional PDF report about React.js"].type,"artifact");

    for (const request of [
      "Create a professional PDF report about React.js",
      "[JAZZ_MODE:NORMAL] Create a professional PDF report about React.js",
      "[JAZZ_MODE:EVIL] Create a professional PDF report about React.js",
      "Create an Excel React expense tracker"
    ]) {
      const response = await fetch(url + "/api/chat", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({message:request,source:"typed",history:[]})
      });
      assert.equal(response.status,200,"HTTP status: " + response.status);
      assert.equal(response.headers.get("x-jazz-routing-build"),"20261008-document-route-guard-v4");
      const result = await response.json();
      assert.equal(result.mode,"artifact-generation",JSON.stringify(result));
      assert.ok(result.artifact?.url?.startsWith("/api/artifacts/"),JSON.stringify(result));
      const file = await fetch(url + result.artifact.url);
      assert.equal(file.status,200);
      const bytes = Buffer.from(await file.arrayBuffer());
      assert.ok(bytes.length > 300);
      assert.equal(bytes.toString("ascii",0,request.includes("PDF")?5:2), request.includes("PDF")?"%PDF-":"PK");
      assert.doesNotMatch(result.assistant,/coding task|model is not ready/i);
    }
    assert.equal(simulatedRunnerCrashes,1,"Expected a simulated local model connection crash");
    assert.equal(fallbackModelsUsed,1,"Document should retry with 0.6B local model exactly once");

    const streamed = await fetch(url + "/api/chat/stream", {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({message:"[JAZZ_MODE:NORMAL] Create a professional PDF report about React.js",source:"typed",history:[]})
    });
    assert.equal(streamed.status,200);
    const body = await streamed.text();
    assert.match(body,/event: done/);
    assert.match(body,/"mode":"artifact-generation"/);
    assert.match(body,/\/api\/artifacts\//);
    assert.doesNotMatch(body,/coding task|model is not ready/i);

    // The user's WhatsApp-style interface uses a different authenticated
    // request route than the main Jazz web chat. Test that exact path too.
    const signIn = await fetch(url + "/api/jazzwhatsapp/auth", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:"jazz-ci",password:"fixture-password-123"})
    });
    assert.equal(signIn.status,400,"An invalid username should be rejected");
    const auth = await fetch(url + "/api/jazzwhatsapp/auth", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:"jazzci",password:"fixture-password-123"})
    });
    assert.equal(auth.status,200,"JazzWhatsApp isolated test login failed");
    const authData = await auth.json();
    const waReply = await fetch(url + "/api/jazzwhatsapp/message", {
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer " + authData.token},
      body:JSON.stringify({text:"Create a professional PDF report about React.js",source:"typed"})
    });
    const waData = await waReply.json();
    assert.equal(waReply.status,200,JSON.stringify(waData));
    assert.match(waData.assistant?.text||"",/\[Download .+\]\(\/api\/artifacts\//);
    assert.doesNotMatch(waData.assistant.text,/coding task|model is not ready|This operation was aborted/i);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([once(child,"exit"),delay(3000)]);
    }
    await new Promise(resolve => mockOllama.close(resolve));
    await fs.rm(isolatedStateDir,{recursive:true,force:true});
  }
});
