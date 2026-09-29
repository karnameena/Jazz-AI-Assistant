import assert from "node:assert/strict";
import test from "node:test";
import { reactTodoFiles } from "./templates/react-todo.mjs";

test("React Todo template produces a self-contained Vite project", () => {
  const files = reactTodoFiles();
  assert.ok(files["package.json"]);
  assert.ok(files["pnpm-workspace.yaml"].includes("esbuild: true"));
  assert.ok(files["src/App.jsx"].includes("Remove ${item.title}"));
  assert.ok(files["src/main.jsx"]);
  assert.ok(files["src/styles.css"]);
});
