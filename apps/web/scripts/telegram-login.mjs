import { createInterface } from "node:readline/promises";
import process from "node:process";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  const apiIdRaw = (process.env.JAZZ_TELEGRAM_API_ID || await rl.question("Telegram api_id: ")).trim();
  const apiHash = (process.env.JAZZ_TELEGRAM_API_HASH || await rl.question("Telegram api_hash: ")).trim();
  const apiId = Number(apiIdRaw);

  if (!Number.isInteger(apiId) || apiId <= 0) throw new Error("A valid Telegram api_id is required.");
  if (!apiHash) throw new Error("Telegram api_hash is required.");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => (await rl.question("Phone number (with country code): ")).trim(),
    password: async () => (await rl.question("Telegram 2FA password (leave blank if none): ")).trim(),
    phoneCode: async () => (await rl.question("Telegram login code: ")).trim(),
    onError: error => console.error("Telegram login error:", error?.message || error)
  });

  const me = await client.getMe();
  const session = client.session.save();

  console.log("\nTelegram account connected:", me?.username ? `@${me.username}` : me?.firstName || me?.first_name || "account");
  console.log("\nAdd this to services/api/.env and keep it private:\n");
  console.log(`JAZZ_TELEGRAM_SESSION=${session}`);
  console.log("\nDo not commit or share that session string. It is a login credential.");

  await client.disconnect();
} finally {
  rl.close();
}
