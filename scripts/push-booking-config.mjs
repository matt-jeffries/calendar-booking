import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const config = await readFile(new URL("../.booking-config.json", import.meta.url), "utf8");
JSON.parse(config);

const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "secret", "put", "BOOKING_CONFIG_JSON", "--config", "wrangler.jsonc"], {
  stdio: ["pipe", "inherit", "inherit"],
});
child.stdin.end(config);
const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (exitCode !== 0) process.exit(typeof exitCode === "number" ? exitCode : 1);
