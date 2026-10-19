import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const privateConfigUrl = new URL("../.booking-config.json", import.meta.url);
const devVarsUrl = new URL("../.dev.vars", import.meta.url);
let template;
try { template = JSON.parse(await readFile(privateConfigUrl, "utf8")); }
catch { template = JSON.parse(await readFile(new URL("../booking.config.example.json", import.meta.url), "utf8")); }
const prompt = createInterface({ input: stdin, output: stdout });

async function ask(label, fallback) {
  const answer = (await prompt.question(`${label} [${fallback}]: `)).trim();
  return answer || fallback;
}

try {
  template.name = await ask("Your display name", template.name);
  template.firstName = await ask("Your first name", template.name.split(/\s+/)[0]);
  template.publicOrigin = await ask("Public URL", "http://localhost:5173");
  template.timezone = await ask("IANA timezone", template.timezone);
  template.timezoneLabel = await ask("Timezone label shown to visitors", template.timezoneLabel);
  template.workingHours.start = await ask("Working day starts", template.workingHours.start);
  template.workingHours.end = await ask("Working day ends", template.workingHours.end);
  template.minimumNoticeMinutes = Number(await ask("Minimum notice in minutes", String(template.minimumNoticeMinutes)));
  const calendars = await ask("Apple calendar names, comma separated (or none)", template.appleCalendarNames.join(", "));
  template.appleCalendarNames = calendars ? calendars.split(",").map((value) => value.trim()).filter(Boolean) : [];

  const pretty = `${JSON.stringify(template, null, 2)}\n`;
  const dotenvValue = JSON.stringify(template).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  let existingDevVars = "";
  try { existingDevVars = await readFile(devVarsUrl, "utf8"); } catch { /* First setup. */ }
  const preservedDevVars = existingDevVars.split(/\r?\n/).filter((line) => !line.startsWith("BOOKING_CONFIG_JSON=")).join("\n").replace(/^\n+|\n+$/g, "");
  await writeFile(privateConfigUrl, pretty, { mode: 0o600 });
  await writeFile(devVarsUrl, `BOOKING_CONFIG_JSON="${dotenvValue}"\n${preservedDevVars ? `${preservedDevVars}\n` : ""}`, { mode: 0o600 });
  stdout.write("\nSaved private configuration to .booking-config.json and .dev.vars. Both are ignored by Git.\n");
  stdout.write("Run npm run dev for a local preview. Run npm run config:push after configuring Cloudflare.\n");
} finally {
  prompt.close();
}
