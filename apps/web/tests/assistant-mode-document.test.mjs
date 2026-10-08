// Browser regression: the web Normal/Evil mode fetch wrapper must not prepend
// control markers to PDF/Word/Excel chat requests. Other modes stay functional.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/assistant-mode-toggle.js");
const script = await fs.readFile(app,"utf8");

test("web fetch middleware preserves document command in Normal and Evil mode", async () => {
  const requests = [];
  const events = {};
  const fakeDocument = {
    readyState:"loading",
    addEventListener(name,listener){events[name] = listener;},
    querySelector(){return null;},
    querySelectorAll(){return [];},
    getElementById(){return null;}
  };
  const fakeWindow = {
    fetch:async (url,init={}) => {
      requests.push({url,body:JSON.parse(init.body||"{}")});
      return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json"}});
    },
    dispatchEvent(){},
    HTMLInputElement:class {}
  };
  const storage={getItem(){return "normal";},setItem(){}};
  const env={
    window:fakeWindow,document:fakeDocument,localStorage:storage,
    MutationObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame(fn){fn();return 1;},
    CustomEvent:class{},
    Response,URL,Request,console,setTimeout,clearTimeout
  };
  vm.runInNewContext(script,env,{filename:"assistant-mode-toggle.js"});
  assert.equal(typeof events.DOMContentLoaded,"function");
  events.DOMContentLoaded();
  const issue = async message => {
    const response = await fakeWindow.fetch("/api/chat",{method:"POST",body:JSON.stringify({message})});
    assert.equal(response.ok,true);
    return requests.at(-1).body;
  };
  const pdf = "Create a professional PDF report about React.js";
  let body = await issue(pdf);
  assert.equal(body.message,pdf);
  assert.equal(body.assistantMode,"normal");

  body = await issue("Generate a Word document on TypeScript");
  assert.equal(body.message,"Generate a Word document on TypeScript");

  fakeWindow.setJazzAssistantMode("evil");
  body=await issue(pdf);
  assert.equal(body.message,pdf);
  assert.equal(body.assistantMode,"evil");

  body=await issue("Create an Excel React expense tracker");
  assert.equal(body.message,"Create an Excel React expense tracker");
  assert.equal(body.assistantMode,"evil");

  // Existing real coding mode tags and other assistant-mode routing remain.
  body=await issue("Create a React todo application");
  assert.equal(body.message,"[JAZZ_MODE:EVIL] Create a React todo application");
  assert.equal(body.assistantMode,"evil");
});
