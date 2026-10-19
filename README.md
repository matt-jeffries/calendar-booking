# Personal Booking Calendar

A self-hosted booking page that checks multiple calendars, creates a video meeting, sends calendar invitations, and gives attendees private reschedule and cancellation links.

It is designed for one person to run without an admin dashboard. Configuration lives in one ignored JSON file, credentials stay in Cloudflare secrets, and the public repository contains only safe example values.

## What it supports

- 30- and 60-minute booking links, including fixed `/30` and `/60` routes
- browser-local time display with scheduling rules in your configured timezone
- Microsoft Outlook/Hotmail calendar availability and invitations
- Google Meet creation through Google Calendar
- optional Apple/iCloud availability across selected calendars
- private cancellation and rescheduling links
- Cloudflare Turnstile bot protection and D1 storage
- optional Resend notifications to the calendar owner
- configurable working hours, notice period, rates, branding and social preview

## Quick start

Requirements: Node.js 22+, npm, a Cloudflare account and Wrangler authentication.

```sh
npm ci
npm run setup
npm run dev
```

`npm run setup` asks a few plain-English questions and creates two private files:

- `.booking-config.json` — the reusable settings for your booking page
- `.dev.vars` — the local runtime copy

Both files are ignored by Git. A safe example is available in [`booking.config.example.json`](booking.config.example.json).

## Deploying

The app runs on Cloudflare Workers with D1. Copy `wrangler.example.jsonc` to `wrangler.jsonc`, add your own account/database/domain details, then follow [the deployment guide](docs/DEPLOYMENT.md).

The short version is:

```sh
npm run config:push
npm run db:migrate:cloudflare
npm run deploy:cloudflare
```

Never put OAuth secrets, app-specific passwords, encryption keys or API keys into the JSON config or `wrangler.jsonc`. Add them as encrypted Worker secrets.

## Configuration

The main settings are intentionally small:

| Setting | Purpose |
| --- | --- |
| `name`, `firstName` | Names shown on the public and management pages |
| `publicOrigin` | The exact HTTPS URL of the deployed site |
| `timezone`, `timezoneLabel` | Scheduling timezone and visitor-facing label |
| `workingDays`, `workingHours` | When bookings may start |
| `minimumNoticeMinutes` | How soon someone may book |
| `maximumAdvanceDays` | How far ahead the calendar opens |
| `meetingDurations` | Available lengths and labels |
| `appleCalendarNames` | iCloud calendars used for availability only |
| `rates` | Optional informational rates shown with `?rates=true` |
| `branding` | Local paths for the avatar, social image and favicon |

Put personal artwork under `public/user/`; that folder is ignored. Point your private configuration to paths such as `/user/avatar.png`. The repository ships with a neutral placeholder.

## Security

The public availability API returns timestamps only. Calendar titles and event details stay server-side. OAuth refresh tokens are encrypted before D1 storage, booking-management tokens are stored as hashes, calendar failures fail closed, and booking writes require same-origin requests plus Turnstile.

Run the complete local verification before deploying:

```sh
npm run check
npm audit --omit=dev
```

See [SECURITY.md](SECURITY.md) for deployment responsibilities and private vulnerability reporting.

## Licence

MIT — see [LICENSE](LICENSE).
