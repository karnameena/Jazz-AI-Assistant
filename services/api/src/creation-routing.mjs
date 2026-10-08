export const ROUTING_BUILD = "20261008-document-route-guard-v4";

// Centralized routing for overlapping "create ... React ..." requests.
// Document requests take precedence over coding-project keywords.
import { detectArtifactIntent } from "./artifact-generation.mjs";
import { detectCodingIntent } from "../../coding-agent/src/intent.mjs";

export function routeCreationIntent(message) {
  const documentKind = detectArtifactIntent(message);
  if (documentKind) return { type: "artifact", kind: documentKind };
  if (detectCodingIntent(message).matched) return { type: "coding" };
  return null;
}
