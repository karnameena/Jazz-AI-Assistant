export type RecoveryVoiceCommand = {
  action: string;
  args: Record<string, unknown>;
  label: string;
};

// Full-utterance matching is intentional: negations, multiple instructions and
// arbitrary assistant requests must never become a recovery command.
const commands: Array<{ pattern: RegExp; command: RecoveryVoiceCommand }> = [
  { pattern: /^(?:get |check |show |refresh )?(?:my )?(?:device|phone|mobile) status$/, command: { action: "DEVICE_STATUS", args: {}, label: "Device Status" } },
  { pattern: /^(?:(?:get|show|send)(?: me)? (?:my )?(?:(?:device|phone|mobile) )?location|(?:locate|find) (?:my )?(?:device|phone|mobile)|where is my (?:device|phone|mobile))$/, command: { action: "GET_LOCATION", args: {}, label: "Get Location" } },
  { pattern: /^(?:ring (?:my )?(?:device|phone|mobile)|make my (?:device|phone|mobile) ring)$/, command: { action: "RING_DEVICE", args: {}, label: "Ring Device" } },
  { pattern: /^(?:(?:take|capture|request) (?:a )?)?front(?: camera)?(?: recovery)?(?: photo| picture)?$/, command: { action: "RECOVERY_PHOTO", args: { camera: "front" }, label: "Front Camera" } },
  { pattern: /^(?:(?:take|capture|request) (?:a )?)?(?:back|rear)(?: camera)?(?: recovery)?(?: photo| picture)?$/, command: { action: "RECOVERY_PHOTO", args: { camera: "rear" }, label: "Back Camera" } },
  { pattern: /^(?:enable|activate|turn on) lost(?: device)? mode$/, command: { action: "SET_RECOVERY_MODE", args: { enabled: true }, label: "Enable Lost Mode" } },
];

export function resolveVoiceCommand(transcript: string): RecoveryVoiceCommand | null {
  const text = transcript.toLowerCase().trim()
    .replace(/^hey[ ,]+jazz[ ,.!:]+/, "")
    .replace(/^please\s+/, "")
    .replace(/[.!?]+$/, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ").trim();
  const match = commands.find(({ pattern }) => pattern.test(text));
  return match ? { ...match.command, args: { ...match.command.args } } : null;
}
