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
      <h1>How I use your booking information.</h1>
      <p className="privacy-lead">This page explains what happens to the details you enter when you book a meeting with {config.name}.</p>

      <h2>What I collect</h2>
      <p>I collect your name, email address, meeting time and anything you add about the meeting. The hosting service also processes technical details, including your IP address, to run and protect the site.</p>

      <h2>Why I use it</h2>
      <p>I use this information to check availability, book or change the meeting, send the calendar invitation and keep a record of our correspondence. I rely on my legitimate interests in arranging meetings you request and keeping an appropriate record. If the meeting concerns paid work, I may also use the information to respond to your request before we agree a contract.</p>

      <h2>Who processes it</h2>
      <p>I do not sell your information or use it for marketing. Cloudflare hosts and protects the site and stores the booking. Google Calendar provides availability, sends the calendar invitation and creates the Meet link, and Resend sends booking notifications to me. Cloudflare Turnstile checks for automated bookings.</p>

      <h2>How long I keep it</h2>
      <p>I do not delete booking records automatically. I keep them as a record of meetings and correspondence. You can ask me to delete your information unless I need to keep it for a legal, accounting or dispute-related reason.</p>

      <h2>Your choices and rights</h2>
      <p>You can ask for a copy of your information, ask me to correct or delete it, restrict how I use it or object to its use. These rights depend on the circumstances. You can also complain to the <a href="https://ico.org.uk/make-a-complaint/data-protection-complaints/data-protection-complaints/" target="_blank" rel="noreferrer">Information Commissioner’s Office</a>.</p>

      <p className="privacy-updated">Last updated: 19 October 2026</p>
    </article>
  </main>;
}
