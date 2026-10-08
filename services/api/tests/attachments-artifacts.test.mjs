import test from "node:test";
import assert from "node:assert/strict";
import {Readable} from "node:stream";
import {analyzeAttachments, attachmentLimits, readAttachmentJson} from "../src/attachment-analysis.mjs";
import {detectArtifactIntent, getArtifact, maybeGenerateArtifact} from "../src/artifact-generation.mjs";

function attached(name, value, mime = "text/plain") {
  return {name, dataUrl: "data:" + mime + ";base64," + Buffer.from(value).toString("base64")};
}

test("attachment payload validates sizes, extensions and does not execute file content", async () => {
  const input = {message:"Summarize the file", attachments:[attached("example.ts","console.log('never execute');")]};
  let sentPrompt = "";
  const result = await analyzeAttachments(input,{
    answerImage: async () => { throw Error("Vision should not be called"); },
    callConfiguredLLM: async prompt => {sentPrompt = prompt; return {text:"Found TypeScript example.",model:"test"};}
  });
  assert.equal(result.mode,"attachment-analysis");
  assert.match(sentPrompt,/console\.log/);
  assert.match(sentPrompt,/untrusted data/);
  assert.equal(result.files[0].name,"example.ts");
  await assert.rejects(
    analyzeAttachments({attachments:[attached("file.exe","payload")]},{}),
    /Unsupported file type/
  );
  assert.equal(attachmentLimits.maxFiles,3);
});

test("image uses existing vision model rather than pretending text LLM sees pixels", async () => {
  const png = Buffer.from("89504e470d0a1a0a00000000","hex");
  const result = await analyzeAttachments({message:"What is this?",attachments:[attached("capture.png",png,"image/png")]},{
    answerImage: async () => ({assistant:"This is a test image.",model:"vision-test"}),
    callConfiguredLLM: async () => {throw Error("Text LLM must not get images");}
  });
  assert.equal(result.mode,"attachment-vision");
  assert.equal(result.model,"vision-test");
});

test("attachment request body reader accepts bounded JSON", async () => {
  const req=Readable.from([Buffer.from('{"attachments":[],"message":"test"}')]);
  const body=await readAttachmentJson(req);
  assert.equal(body.message,"test");
});

test("document intents are narrow and do not hijack normal questions", () => {
  assert.equal(detectArtifactIntent("Create a professional PDF report"),"pdf");
  assert.equal(detectArtifactIntent("Generate a Word letter"),"docx");
  assert.equal(detectArtifactIntent("Create an Excel expense tracker"),"xlsx");
  assert.equal(detectArtifactIntent("How do I create a PDF?"),null);
});

test("Excel generator creates actual workbook with formulas and retrievable bytes", async () => {
  const result=await maybeGenerateArtifact("Create an Excel expense tracker",async()=>{throw Error("Template needs no LLM");});
  const token=result.artifact.url.split("/").pop();
  const item=getArtifact(token);
  assert.equal(item.buffer.toString("utf8",0,2),"PK");
  assert.match(result.assistant,/Download/);
  assert.ok(item.buffer.length > 800);
});

test("PDF and Word generator return actual file signatures", async () => {
  const content="# Introduction\nThis is a sample report written for automated validation.\n# Recommendations\nUse a bounded context window.";
  for(const kind of ["PDF","Word"]){
    const result=await maybeGenerateArtifact("Create a "+kind+" report",async()=>content);
    const token=result.artifact.url.split("/").pop();
    const item=getArtifact(token);
    assert.ok(item.buffer.length > 400);
    if(kind==="PDF")assert.equal(item.buffer.toString("ascii",0,5),"%PDF-");
    else assert.equal(item.buffer.toString("ascii",0,2),"PK");
  }
});
