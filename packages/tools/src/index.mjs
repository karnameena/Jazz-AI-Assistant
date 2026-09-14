export const tools = {
  weather: {
    description: "Get weather from an approved weather provider",
    requiresConfirmation: false
  },
  android: {
    description: "Execute an explicitly authorized Android action",
    requiresConfirmation: true
  },
  pc: {
    description: "Execute an explicitly authorized PC action",
    requiresConfirmation: true
  }
};

export function listTools() {
  return Object.entries(tools).map(([name, value]) => ({ name, ...value }));
}
