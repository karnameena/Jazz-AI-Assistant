export function planToolExecution(request, policies = []) {
  const policy = policies.find(p => p.tool === request.name);
  if (!policy?.allowed) {
    return { allowed: false, requiresConfirmation: false, reason: "Tool is not allowed" };
  }
  return {
    allowed: true,
    requiresConfirmation: Boolean(policy.requiresConfirmation),
    reason: policy.requiresConfirmation ? "User confirmation required" : "Allowed"
  };
}
