import crypto from "node:crypto";
import { codingConfig } from "./config.mjs";
import { detectCodingIntent } from "./intent.mjs";
import { getCodingModelStatus, askCodingModel } from "./model.mjs";
import { createSession, getSession, latestSession, listSessions, updateSession } from "./session-store.mjs";
import { createWorkspace, listWorkspaceFiles, writeWorkspaceFile } from "./workspace.mjs";
import { installDependencies, runPackageScript, codingTools } from "./tools.mjs";
import { reactTodoFiles } from "./templates/react-todo.mjs";

function isReactTodoRequest(text) {
  return /\breact\b/i.test(text) && /\btodo(?:\s+(?:app|application|list))?\b/i.test(text) && /\b(create|build|generate|scaffold|make)\b/i.test(text);
}

function approvalIntent(message) {
  const text = String(message || "").trim();
  return /^(?:hey\s+jazz[, ]*)?(?:approve|confirm)\s+(?:the\s+)?coding(?:\s+(?:dependencies|install|task))?[!. ]*$/i.test(text)
    || /^(?:hey\s+jazz[, ]*)?approve\s+coding\s+dependencies[!. ]*$/i.test(text);
}

async function createReactTodoTask(requestText) {
  const workspace = await createWorkspace("react-todo");
  const files = reactTodoFiles();
  for (const [relativePath, content] of Object.entries(files)) {
    await writeWorkspaceFile(workspace.root, relativePath, content);
  }
  const createdFiles = await listWorkspaceFiles(workspace.root);
  const session = await createSession({
    id: crypto.randomUUID(),
    kind: "create_project",
    request: requestText,
    workspaceId: workspace.id,
    workspaceRoot: workspace.root,
    status: "awaiting_dependency_approval",
    createdAt: new Date().toISOString(),
    filesCreated: createdFiles,
    filesModified: [],
    filesDeleted: [],
    commandsExecuted: [],
    validation: null,
    integrationApplied: false,
    plan: [
      "Create an isolated Vite + React workspace.",
      "Generate a responsive Todo UI with add, toggle and remove behavior.",
      "Request approval before installing dependencies.",
      "After approval, install dependencies and run the build.",
      "Keep the working Jazz repository unchanged."
    ]
  });
  return {
    assistant: `Mama 💻 I created the React Todo application in an isolated Jazz coding workspace. I did not modify the working Jazz project. Created ${createdFiles.length} files. Dependency installation is blocked until you approve it. Say **“Jazz, approve coding dependencies”** and I’ll install them inside this workspace and run the build.`,
    mode: "coding-agent",
    coding: {
      taskId: session.id,
      status: session.status,
      workspaceId: session.workspaceId,
      plan: session.plan,
      filesCreated: createdFiles,
      approvalRequired: "install_dependencies"
    }
  };
}

async function createGenericPlanningTask(intent) {
  const workspace = await createWorkspace(intent.kind || "coding-task");
  const session = await createSession({
    id: crypto.randomUUID(),
    kind: intent.kind,
    request: intent.text,
    workspaceId: workspace.id,
    workspaceRoot: workspace.root,
    status: "planning",
    createdAt: new Date().toISOString(),
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    commandsExecuted: [],
    validation: null,
    integrationApplied: false
  });

  try {
    const result = await askCodingModel({
      system: "You are Jazz Coding Agent planner. Produce a concise implementation plan only. Never request secrets. Never assume unrestricted shell access. All code changes must remain inside the provided isolated workspace until the user approves integration.",
      user: `Task: ${intent.text}\nReturn a numbered plan with likely files, validation steps, and any dependency-install approval needed.`
    });
    const updated = await updateSession(session.id, { status: "planned", model: result.model, planText: result.text });
    return {
      assistant: `Mama 💻 the coding request is isolated in workspace **${updated.workspaceId}**. I prepared the implementation plan with the local coding model. No existing Jazz files were changed.\n\n${result.text}`,
      mode: "coding-agent",
      coding: { taskId: updated.id, status: updated.status, workspaceId: updated.workspaceId, model: result.model }
    };
  } catch (error) {
    const updated = await updateSession(session.id, { status: "model_unavailable", lastError: error instanceof Error ? error.message : String(error) });
    return {
      assistant: `Mama 💻 I isolated the coding task, but the dedicated local coding model is not ready yet. ${updated.lastError} Your normal Jazz commands are unaffected.`,
      mode: "coding-agent",
      coding: { taskId: updated.id, status: updated.status, workspaceId: updated.workspaceId }
    };
  }
}

async function approveLatestDependencies() {
  const session = await latestSession();
  if (!session || session.status !== "awaiting_dependency_approval") {
    return { assistant: "Mama, there isn’t a coding task currently waiting for dependency approval.", mode: "coding-agent" };
  }

  const commands = [...(session.commandsExecuted || [])];
  const install = await installDependencies(session.workspaceRoot, true);
  commands.push({ command: install.command, ok: install.ok, code: install.code });
  if (!install.ok) {
    const updated = await updateSession(session.id, {
      status: "validation_failed",
      commandsExecuted: commands,
      validation: { install, build: null },
      lastError: install.stderr || install.stdout || "Dependency installation failed."
    });
    return {
      assistant: `Mama 💻 dependency installation failed inside the isolated workspace, so I stopped without touching Jazz. ${updated.lastError}`,
      mode: "coding-agent",
      coding: { taskId: updated.id, status: updated.status, workspaceId: updated.workspaceId }
    };
  }

  const build = await runPackageScript(session.workspaceRoot, "build");
  commands.push({ command: build.command, ok: build.ok, code: build.code, skipped: Boolean(build.skipped) });
  const status = build.ok ? "ready_for_review" : "validation_failed";
  const updated = await updateSession(session.id, {
    status,
    commandsExecuted: commands,
    validation: { install, build },
    lastError: build.ok ? null : (build.stderr || build.stdout || "Build failed.")
  });

  if (!build.ok) {
    return {
      assistant: `Mama 💻 dependencies installed, but the isolated React Todo build failed. I preserved the original Jazz project unchanged. Build error: ${updated.lastError}`,
      mode: "coding-agent",
      coding: { taskId: updated.id, status: updated.status, workspaceId: updated.workspaceId, validation: updated.validation }
    };
  }

  return {
    assistant: `Mama 💻✅ the isolated React Todo application is ready. Dependencies installed successfully and the production build passed. The original Jazz project is still unchanged. Task ${updated.id} is ready for review; nothing was merged or pushed.`,
    mode: "coding-agent",
    coding: {
      taskId: updated.id,
      status: updated.status,
      workspaceId: updated.workspaceId,
      filesCreated: updated.filesCreated,
      commandsExecuted: updated.commandsExecuted,
      build: "passed",
      integrationApplied: false
    }
  };
}

export async function handleCodingIntent(message) {
  if (approvalIntent(message)) return approveLatestDependencies();
  const intent = detectCodingIntent(message);
  if (!intent.matched) return null;
  if (isReactTodoRequest(intent.text)) return createReactTodoTask(intent.text);
  return createGenericPlanningTask(intent);
}

export async function getCodingTask(id) {
  return getSession(id);
}

export async function listCodingTasks() {
  return listSessions();
}

export async function getCodingAgentHealth() {
  const cfg = codingConfig();
  const model = await getCodingModelStatus();
  return {
    ok: true,
    service: "jazz-coding-agent",
    isolated: true,
    workspaceRoot: cfg.workspaceRoot,
    model,
    tools: codingTools,
    destructiveShellEnabled: false,
    automaticPushEnabled: false,
    automaticMergeEnabled: false
  };
}

export { detectCodingIntent } from "./intent.mjs";
