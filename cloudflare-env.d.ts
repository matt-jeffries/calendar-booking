declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    MICROSOFT_CLIENT_ID?: string;
    MICROSOFT_CLIENT_SECRET?: string;
    MICROSOFT_TENANT_ID?: string;
    APPLE_CALDAV_USERNAME?: string;
    APPLE_CALDAV_PASSWORD?: string;
    CALENDAR_TOKEN_KEY?: string;
    CALENDAR_SETUP_KEY?: string;
    RESEND_API_KEY?: string;
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
    BOOKING_CONFIG_JSON?: string;
    MICROSOFT_EXPECTED_ACCOUNT?: string;
    NOTIFICATION_FROM?: string;
    NOTIFICATION_TO?: string;
  }
}
