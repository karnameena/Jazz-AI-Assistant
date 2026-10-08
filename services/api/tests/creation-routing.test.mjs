import test from "node:test";
import assert from "node:assert/strict";
import { routeCreationIntent } from "../src/creation-routing.mjs";
import { chooseInstalledCodingModel } from "../../coding-agent/src/model.mjs";
import { maybeGenerateArtifact, getArtifact } from "../src/artifact-generation.mjs";

test("PDF reports about React.js are files, never 30B coding tasks", async () => {
  const request = "Create a professional PDF report about React.js";
  assert.deepEqual(routeCreationIntent(request), {type:"artifact", kind:"pdf"});
  // The Jazz web UI's legacy Normal/Evil mode middleware used to prefix all
  // requests and accidentally convert document requests into coding projects.
  for (const mode of ["NORMAL","EVIL"]) {
    const wrapped = "[JAZZ_MODE:" + mode + "] " + request;
    assert.deepEqual(routeCreationIntent(wrapped), {type:"artifact",kind:"pdf"});
  }
  let docPrompt = "";
  const output = await maybeGenerateArtifact(request, async prompt => {
    docPrompt = prompt;
    return "# Executive Summary\nReact is a UI library.\n## Key Concepts\nComponents render interfaces.\n## Conclusion\nGood patterns make code maintainable.";
  });
  assert.equal(output.mode, "artifact-generation");
  assert.match(docPrompt,/executive summary/i);
  assert.match(docPrompt,/React\.js/);
  assert.match(output.artifact.filename,/reactjs-professional-report\.pdf/);
  assert.equal(getArtifact(output.artifact.url.split("/").pop()).buffer.toString("ascii",0,5),"%PDF-");
  const prefixed = await maybeGenerateArtifact("[JAZZ_MODE:NORMAL] " + request,
    async () => "# Executive Summary\nReact builds user interfaces.");
  assert.equal(prefixed.mode, "artifact-generation");
  assert.match(prefixed.artifact.filename,/reactjs-professional-report[.]pdf/);
});

test("Word and Excel creation outrank coding keywords", () => {
  assert.deepEqual(routeCreationIntent("Generate a Word document on TypeScript"),{type:"artifact",kind:"docx"});
  assert.deepEqual(routeCreationIntent("Create an Excel React learning tracker"),{type:"artifact",kind:"xlsx"});
});

test("real coding tasks and regular conversation are unchanged", () => {
  assert.deepEqual(routeCreationIntent("Create a React todo application"),{type:"coding"});
  assert.deepEqual(routeCreationIntent("Fix errors in my React project"),{type:"coding"});
  assert.equal(routeCreationIntent("Explain React useEffect"),null);
  assert.equal(routeCreationIntent("How do I create a PDF?"),null);
});

test("auto coding uses installed open-source models, never invented 30B", () => {
  assert.equal(chooseInstalledCodingModel(["qwen3:0.6b"],"auto"),"qwen3:0.6b");
  assert.equal(chooseInstalledCodingModel(["qwen3:0.6b","qwen2.5-coder:3b"],"auto"),"qwen2.5-coder:3b");
  assert.equal(chooseInstalledCodingModel(["nomic-embed-text:latest","qwen2.5:3b"],"auto"),"qwen2.5:3b");
  assert.equal(chooseInstalledCodingModel(["qwen3:0.6b"],"qwen3-coder:30b"),null);
  assert.equal(chooseInstalledCodingModel(["nomic-embed-text:latest"],"auto"),null);
});
