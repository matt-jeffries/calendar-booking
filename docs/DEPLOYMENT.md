# Cloudflare deployment

This guide separates ordinary settings from credentials. The commands are the same on macOS, Linux and Windows PowerShell unless noted.

## 1. Create the Cloudflare resources

1. Authenticate Wrangler with the Cloudflare account that will own the app.
2. Create a D1 database: `npx wrangler d1 create my-booking-calendar`.
3. Copy `wrangler.example.jsonc` to `wrangler.jsonc`.
4. Replace the Worker name, D1 database ID and custom domain with your own values.
5. Run `npm run setup` and use the exact deployed URL for `publicOrigin`.
6. Upload that configuration with `npm run config:push`.

`wrangler.jsonc`, `.booking-config.json`, `.dev.vars`, `.cloudflare-auth/` and `public/user/` are ignored by Git.

## 2. Add required secrets

Use `npx wrangler secret put NAME --config wrangler.jsonc` for each value. Wrangler reads the value privately from the terminal.

Required for calendar connections:

- `CALENDAR_TOKEN_KEY` — 32 random bytes encoded as base64
- `CALENDAR_SETUP_KEY` — a long random passphrase protecting the one-time connection pages

Google Meet creation:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Microsoft Outlook/Hotmail availability and invitations:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_EXPECTED_ACCOUNT` — the one Microsoft email address allowed to connect

Apple/iCloud availability only:

- `APPLE_CALDAV_USERNAME`
- `APPLE_CALDAV_PASSWORD` — a revocable Apple app-specific password

Turnstile:

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`

Optional Resend owner notification:

- `RESEND_API_KEY`
- `NOTIFICATION_FROM` — for example `Bookings <bookings@example.com>`
- `NOTIFICATION_TO`

## 3. Configure OAuth providers

Register these exact callback URLs, replacing the hostname with your own:

- Google: `https://booking.example.com/api/integrations/google/callback`
- Microsoft: `https://booking.example.com/api/integrations/microsoft/callback`

The Google connection needs `openid`, `email` and `calendar.events`. The Microsoft connection uses the consumer tenant and needs `offline_access`, `User.Read` and `Calendars.ReadWrite`.

After the first deployment, visit the provider setup route and enter `CALENDAR_SETUP_KEY`:

- `/api/integrations/google/connect`
- `/api/integrations/microsoft/connect`

## 4. Migrate, verify and deploy

```sh
npm run check
npm run db:migrate:cloudflare
npm run deploy:cloudflare
```

Test availability, one complete booking, rescheduling and cancellation before sharing the URL.

## Updating safely

Run `npm audit --omit=dev` and `npm run check`, review migration files, take a D1 backup for schema changes, then deploy. Rotate any credential immediately if it is ever printed, pasted into an issue, or committed.
