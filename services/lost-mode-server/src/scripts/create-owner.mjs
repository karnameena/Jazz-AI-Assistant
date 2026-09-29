import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyMigrations, db } from "../db/database.mjs";
import { hashSecret, validatePassword } from "../auth/password.mjs";

applyMigrations();
const rl = readline.createInterface({ input, output });
try {
  const username = (await rl.question("Lost Mode username: ")).trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error("Username must be 3-40 characters and use letters, numbers, dot, underscore or dash.");
  if (db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE").get(username)) throw new Error("That username already exists.");

  const password = await rl.question("Password (input may be visible in this terminal): ");
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const confirm = await rl.question("Confirm password: ");
  if (password !== confirm) throw new Error("Passwords do not match.");

  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username, hashSecret(password));
  console.log("Owner created. Plaintext password was not stored or logged.");
} finally {
  rl.close();
}
