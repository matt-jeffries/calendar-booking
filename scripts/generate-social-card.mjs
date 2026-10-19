import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const config = JSON.parse(await readFile(path.join(root, ".booking-config.json"), "utf8"));
const portrait = await readFile(path.join(root, "public", "user", "avatar.png"));
const portraitData = `data:image/png;base64,${portrait.toString("base64")}`;
const escapeXml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const meetingLengths = config.meetingDurations.map((item) => item.minutes).join(" or ");

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#21152e"/>
      <stop offset="1" stop-color="#3b1f55"/>
    </linearGradient>
    <clipPath id="portrait-clip">
      <rect x="820" y="92" width="318" height="446" rx="42"/>
    </clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#background)"/>
  <circle cx="1085" cy="50" r="340" fill="none" stroke="#d8b4fe" stroke-opacity=".14" stroke-width="2"/>
  <circle cx="1060" cy="80" r="245" fill="none" stroke="#d8b4fe" stroke-opacity=".1" stroke-width="2"/>
  <circle cx="-60" cy="625" r="250" fill="#d8b4fe" fill-opacity=".05"/>

  <text x="72" y="92" fill="#d8b4fe" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" letter-spacing="4">${escapeXml(config.name.toUpperCase())}</text>
  <text x="72" y="206" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="700" letter-spacing="-3">
    <tspan x="72">Book a meeting</tspan>
    <tspan x="72" dy="76">with me.</tspan>
  </text>
  <text x="76" y="383" fill="#dfd1e7" font-family="Arial, Helvetica, sans-serif" font-size="25">
    <tspan x="76">Choose a ${escapeXml(meetingLengths)} minute time</tspan>
    <tspan x="76" dy="36">that works for you.</tspan>
  </text>
  <rect x="72" y="500" width="315" height="58" rx="29" fill="#d8b4fe"/>
  <text x="106" y="537" fill="#21152e" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700">${escapeXml(config.videoProvider)}  ·  ${escapeXml(config.workingHours.start)}–${escapeXml(config.workingHours.end)}</text>

  <rect x="804" y="76" width="350" height="478" rx="52" fill="#d8b4fe" fill-opacity=".18" stroke="#d8b4fe" stroke-width="2"/>
  <image x="820" y="92" width="318" height="446" preserveAspectRatio="xMidYMid slice" clip-path="url(#portrait-clip)" xlink:href="${portraitData}"/>
</svg>`;

await sharp(Buffer.from(svg))
  .png({ quality: 92 })
  .toFile(path.join(root, "public", "user", "social-card.png"));
