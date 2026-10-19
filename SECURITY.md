# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for the repository. Do not include credentials, calendar data, booking links or attendee information in a public issue.

## Supported version

Security fixes are made on the default branch. This is a small personal project, so older releases are not maintained separately.

## Deployment responsibilities

- Store credentials with Cloudflare Worker secrets, never in source files or `wrangler.jsonc`.
- Use a unique 32-byte `CALENDAR_TOKEN_KEY` and a strong `CALENDAR_SETUP_KEY`.
- Restrict OAuth redirect URLs to the deployed domain.
- Keep Turnstile enabled on public booking forms.
- Apply D1 migrations before deploying a version that requires them.
- Review Cloudflare access, DNS and audit logs regularly.
