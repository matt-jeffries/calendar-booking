import type { Metadata } from "next";
import Link from "next/link";
import { getBookingConfig } from "@/lib/runtime-config";

export function generateMetadata(): Metadata {
  const config = getBookingConfig();
  return { title: `Privacy notice · ${config.name}`, description: `How personal information is used when you book a meeting with ${config.name}.` };
}

export default function PrivacyPage() {
  const config = getBookingConfig();
  return <main className="privacy-page">
    <article className="privacy-card">
      <Link className="manage-home" href="/">← Back to booking</Link>
      <p className="section-kicker">Privacy notice</p>
      <h1>Your booking information.</h1>
      <p className="privacy-lead">This is a personal booking tool run by {config.name}. I only use the information you provide to arrange, hold and keep a record of meetings with me.</p>

      <h2>What I collect</h2>
      <p>Your name, email address, meeting time and anything you choose to write in the meeting-context box. The hosting service may also process basic technical information, such as your IP address, to operate and secure the site.</p>

      <h2>Why I use it</h2>
      <p>I use the information to check availability, create and manage the booking, send calendar invitations and meeting links, and correspond with you about the meeting. I rely on my legitimate interests in arranging requested meetings and keeping an appropriate record of them. Where a meeting concerns potential paid work, I may also use it to take steps at your request before entering into a contract.</p>

      <h2>Who processes it</h2>
      <p>I do not sell your information or use it for marketing. It may be processed by the services that host and protect the site, store the booking, check availability, manage calendar invitations, create video links or deliver booking emails—currently Cloudflare, Microsoft, Apple and Google, with Resend used for booking notifications. Cloudflare Turnstile uses browser and device signals to help prevent automated bookings and other abuse.</p>

      <h2>How long I keep it</h2>
      <p>There is currently no automatic deletion schedule. I keep booking records as a personal record of meetings and correspondence. You can ask me to delete your information; I will do so unless I need to retain it for a legal, accounting or dispute-related reason.</p>

      <h2>Your choices and rights</h2>
      <p>You can ask for a copy of your information, ask me to correct or delete it, restrict how I use it, or object to its use. These rights depend on the circumstances. You can also complain to the <a href="https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/" target="_blank" rel="noreferrer">Information Commissioner’s Office</a>.</p>

      <p className="privacy-updated">Last updated: 19 October 2026</p>
    </article>
  </main>;
}
