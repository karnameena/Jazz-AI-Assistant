export type JazzRole = "user" | "assistant" | "tool";

export interface JazzMessage {
  role: JazzRole;
  content: string;
  createdAt: string;
}

export interface ToolRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: unknown;
  error?: string;
}

export interface PermissionPolicy {
  tool: string;
  requiresConfirmation: boolean;
  allowed: boolean;
}

export const JAZZ_NAME = "Jazz";
export const WAKE_PHRASE = "Hey Jazz";
