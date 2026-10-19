import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "booking-favicon-"));
const resizedAvatar = join(temporaryDirectory, "avatar.png");

try {
  execFileSync("sips", ["-z", "128", "122", "public/user/avatar.png", "--out", resizedAvatar], { stdio: "ignore" });
  const embeddedAvatar = readFileSync(resizedAvatar).toString("base64");
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><clipPath id="rounded"><rect width="128" height="128" rx="28"/></clipPath></defs>
  <g clip-path="url(#rounded)"><image href="data:image/png;base64,${embeddedAvatar}" width="128" height="128" preserveAspectRatio="xMidYMid slice"/></g>
  <rect x="2" y="2" width="124" height="124" rx="26" fill="none" stroke="#2d1743" stroke-width="4"/>
</svg>\n`;
  writeFileSync("public/user/favicon.svg", favicon);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
