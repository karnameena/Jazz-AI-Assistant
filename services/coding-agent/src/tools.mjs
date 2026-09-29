import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertWorkspacePath } from "./security.mjs";

export async function readFileTool(workspaceRoot, relativePath) {
  const target = assertWorkspacePath(workspaceRoot, relativePath);
  return fs.readFile(target, "utf8");
}

export async function createFileTool(workspaceRoot, relativePath, content) {
  const target = assertWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(content), { encoding: "utf8", flag: "wx" });
  return { path: relativePath };
}

export async function editFileTool(workspaceRoot, relativePath, content) {
  const target = assertWorkspacePath(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(content), "utf8");
  return { path: relativePath };
}

export async function createDirectoryTool(workspaceRoot, relativePath) {
  await fs.mkdir(assertWorkspacePath(workspaceRoot, relativePath), { recursive: true });
  return { path: relativePath };
}

async function packageJson(workspaceRoot) {
  try {
    return JSON.parse(await fs.readFile(assertWorkspacePath(workspaceRoot, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function executable(name) {
  if (process.platform === "win32" && name === "pnpm") return "pnpm.cmd";
  if (process.platform === "win32" && name === "npm") return "npm.cmd";
  return name;
}

function runExact(command, args, cwd, timeoutMs = 180000) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(executable(command), args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, CI: "1" }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      stderr += "\n[Jazz Coding] Command timed out.";
    }, timeoutMs);
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timer);
      finish({ ok: false, code: null, command: [command, ...args].join(" "), stdout: stdout.trim(), stderr: `${stderr}\n${error.message}`.trim() });
    });
    child.on("close", code => {
      clearTimeout(timer);
      finish({ ok: code === 0, code, command: [command, ...args].join(" "), stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function installDependencies(workspaceRoot, approved = false) {
  if (!approved) throw new Error("APPROVAL_REQUIRED: dependency installation");
  const pkg = await packageJson(workspaceRoot);
  if (!pkg) throw new Error("package.json not found in workspace");
  return runExact("pnpm", ["install"], workspaceRoot, 300000);
}

export async function runPackageScript(workspaceRoot, scriptName) {
  const allowed = new Set(["build", "test", "lint", "typecheck"]);
  if (!allowed.has(scriptName)) throw new Error("COMMAND_NOT_ALLOWED");
  const pkg = await packageJson(workspaceRoot);
  if (!pkg?.scripts?.[scriptName]) {
    return { ok: true, skipped: true, command: null, stdout: "", stderr: `No '${scriptName}' script defined.` };
  }
  return runExact("pnpm", ["run", scriptName], workspaceRoot, 300000);
}

export async function gitStatus(workspaceRoot) {
  return runExact("git", ["status", "--short"], workspaceRoot, 30000);
}

export async function gitDiff(workspaceRoot) {
  return runExact("git", ["diff", "--stat"], workspaceRoot, 30000);
}

export const codingTools = Object.freeze({
  read_file: { risk: "low", requiresApproval: false },
  create_file: { risk: "medium", requiresApproval: false, workspaceOnly: true },
  edit_file: { risk: "medium", requiresApproval: false, workspaceOnly: true },
  create_directory: { risk: "low", requiresApproval: false, workspaceOnly: true },
  run_build: { risk: "medium", requiresApproval: false, allowlisted: true },
  run_tests: { risk: "medium", requiresApproval: false, allowlisted: true },
  run_linter: { risk: "medium", requiresApproval: false, allowlisted: true },
  install_dependencies: { risk: "high", requiresApproval: true },
  apply_to_main_project: { risk: "high", requiresApproval: true },
  git_push: { risk: "blocked", requiresApproval: true, blocked: true }
});
