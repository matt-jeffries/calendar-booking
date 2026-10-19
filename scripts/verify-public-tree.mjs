import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
const files = output.split("\0").filter(Boolean);
const forbiddenFiles = new Set([".booking-config.json", ".dev.vars", "wrangler.jsonc"]);
const findings = [];

for (const file of files) {
  if (forbiddenFiles.has(file) || file.startsWith("public/user/")) findings.push(`${file}: private file must remain ignored`);
  let content;
  try { content = await readFile(new URL(file, root), "utf8"); }
  catch { continue; }

  const emails = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    if (!email.endsWith("@example.com") && !email.endsWith("@sites.test")) findings.push(`${file}: non-example email address ${email}`);
  }
  if (/(?:AIza[0-9A-Za-z_-]{30,}|sk-[0-9A-Za-z_-]{20,}|re_[0-9A-Za-z_-]{20,})/.test(content)) findings.push(`${file}: possible API credential`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) findings.push(`${file}: private key material`);
}

if (findings.length) {
  console.error("The public-tree check found data that should not be published:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Public-tree check passed (${files.length} files scanned).`);
