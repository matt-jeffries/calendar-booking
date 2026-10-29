"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BookingUiConfig } from "@/lib/booking-config";
import { localDateKey, localTimeLabel, localZoneLabel, ukLocalToDate } from "@/lib/client-time";
import TurnstileWidget from "@/components/turnstile-widget";
import { meetingTopics } from "@/lib/meeting-topic";

type Props = {
  config: BookingUiConfig;
  fixedDuration?: 30 | 60;
  showRates: boolean;
  turnstileSiteKey: string | null;
  embedded?: boolean;
  embedOrigins?: string[];
};
type Result = { manageUrl: string; meetingUrl: string | null; integrationStatus: string };
type AvailableSlot = { label: string; startUk: string };
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const minutesFromTime = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const sameDate = (a: Date | null, b: Date) => Boolean(a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());

export default function BookingApp({ config, fixedDuration, showRates, turnstileSiteKey, embedded = false, embedOrigins = [] }: Props) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [duration, setDuration] = useState<number>(fixedDuration ?? config.meetingDurations[0].minutes);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedStartUk, setSelectedStartUk] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [guest, setGuest] = useState({ name: "", email: "", topic: meetingTopics[0] as string, context: "" });
  const rootRef = useRef<HTMLElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [availabilityState, setAvailabilityState] = useState<{ key: string; data: Record<string, AvailableSlot[]> | null; error: string }>({ key: "", data: null, error: "" });
  const zoneLabel = useSyncExternalStore(() => () => {}, localZoneLabel, () => "Your local time");

  // Embedded on an allowed site: report height so the parent sizes the frame, and accept name, email and topic it already knows.
  useEffect(() => {
    if (!embedded || window.parent === window) return;
    const root = rootRef.current;
    if (!root) return;
    const post = () => embedOrigins.forEach((origin) => window.parent.postMessage({ type: "booking:height", height: Math.ceil(root.getBoundingClientRect().height) }, origin));
    const observer = new ResizeObserver(post);
    observer.observe(root);
    const receive = (event: MessageEvent) => {
      if (!embedOrigins.includes(event.origin) || event.data?.type !== "booking:prefill") return;
      const data = event.data as { name?: unknown; email?: unknown; topic?: unknown };
      setGuest((current) => ({
        ...current,
        name: current.name || (typeof data.name === "string" ? data.name.slice(0, 120) : ""),
        email: current.email || (typeof data.email === "string" ? data.email.slice(0, 254) : ""),
        topic: meetingTopics.find((topic) => topic === data.topic) ?? current.topic,
      }));
    };
    window.addEventListener("message", receive);
    post();
    return () => { observer.disconnect(); window.removeEventListener("message", receive); };
  }, [embedded, embedOrigins]);

  const calendarDays = useMemo(() => {
    const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);

  const availabilityKey = useMemo(() => {
    const from = dateKey(new Date(calendarDays[0].getFullYear(), calendarDays[0].getMonth(), calendarDays[0].getDate() - 1));
    const lastDay = calendarDays[calendarDays.length - 1];
    const to = dateKey(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1));
    return `${from}|${to}|${duration}`;
  }, [calendarDays, duration]);
  const availability = availabilityState.key === availabilityKey ? availabilityState.data : null;
  const availabilityError = availabilityState.key === availabilityKey ? availabilityState.error : "";

  useEffect(() => {
    const controller = new AbortController();
    const from = dateKey(new Date(calendarDays[0].getFullYear(), calendarDays[0].getMonth(), calendarDays[0].getDate() - 1));
    const lastDay = calendarDays[calendarDays.length - 1];
    const to = dateKey(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1));
    fetch(`/api/availability?from=${from}&to=${to}&duration=${duration}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { slots?: Array<{ startUk: string }>; error?: string };
        if (!response.ok || !payload.slots) throw new Error(payload.error ?? "We couldn’t load the available times. Refresh the page and try again.");
        const grouped: Record<string, AvailableSlot[]> = {};
        for (const slot of payload.slots) {
          const instant = ukLocalToDate(slot.startUk);
          const key = localDateKey(instant);
          (grouped[key] ??= []).push({ label: localTimeLabel(instant), startUk: slot.startUk });
        }
        setAvailabilityState({ key: availabilityKey, data: grouped, error: "" });
      })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setAvailabilityState({ key: availabilityKey, data: null, error: reason.message }); });
    return () => controller.abort();
  }, [availabilityKey, calendarDays, duration]);

  const statusFor = (date: Date) => {
    const floorToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (date < floorToday) return "unavailable";
    const count = availability?.[dateKey(date)]?.length ?? 0;
    if (!count) return "unavailable";
    const possible = Math.floor((minutesFromTime(config.workingHours.end) - minutesFromTime(config.workingHours.start) - duration) / config.slotIntervalMinutes) + 1;
    return count < possible / 2 ? "limited" : "available";
  };

  const initialDate = useMemo(() => {
    if (!availability || selectedDate) return null;
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return calendarDays.find((date) => date >= startOfToday && (availability[dateKey(date)]?.length ?? 0) > 0) ?? null;
  }, [availability, calendarDays, selectedDate, today]);
  const displayedDate = selectedDate ?? initialDate;

  const slots = useMemo(() => {
    if (!displayedDate) return [];
    return availability?.[dateKey(displayedDate)] ?? [];
  }, [displayedDate, availability]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayedDate || !selectedTime || !selectedStartUk) return;
    if (!turnstileToken) { setError("Wait for the security check to finish."); return; }
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: guest.name, email: guest.email, topic: guest.topic, context: guest.context, startLocal: selectedStartUk, duration, turnstileToken }),
      });
      const payload = await response.json() as Result & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "We couldn’t book the meeting. Try again.");
        setTurnstileResetKey((value) => value + 1);
        return;
      }
      setResult(payload);
    } catch {
      setError("We couldn’t book the meeting. Check your connection and try again.");
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!detailsOpen) return;
    const card = rootRef.current?.querySelector(".booking-card");
    if (!card) return;
    if (embedded && window.parent !== window) embedOrigins.forEach((origin) => window.parent.postMessage({ type: "booking:step" }, origin));
    else if (card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth" });
  }, [detailsOpen, result, embedded, embedOrigins]);

  const clock = (time: string) => { const [h, m] = time.split(":").map(Number); return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`; };
  const hoursLabel = `${clock(config.workingHours.start)}–${clock(config.workingHours.end)}`;
  const openDetails = () => { setDetailsOpen(true); setResult(null); setError(""); setTurnstileToken(""); setTurnstileError(""); };
  // On phones the Continue button would sit below a long list of times, so a tap goes straight to the details step.
  const pickSlot = (slot: AvailableSlot) => { setSelectedDate(displayedDate); setSelectedTime(slot.label); setSelectedStartUk(slot.startUk); if (window.matchMedia("(max-width: 700px)").matches) openDetails(); };
  const longDate = displayedDate?.toLocaleDateString(config.locale, { weekday: "long", day: "numeric", month: "long" });
  const field = (key: "name" | "email" | "context") => ({ value: guest[key], onChange: (event: { target: { value: string } }) => setGuest((current) => ({ ...current, [key]: event.target.value })) });

  const durationPicker = !fixedDuration && <div className="who-durations" role="radiogroup" aria-label="Meeting length"><span className="micro-label">Meeting length</span>{config.meetingDurations.map((option) => <button key={option.minutes} type="button" className={`duration ${duration === option.minutes ? "active" : ""}`} onClick={() => { setDuration(option.minutes); setSelectedTime(null); setSelectedStartUk(null); }} role="radio" aria-checked={duration === option.minutes}><span className="duration-time">{option.minutes}</span><span className="duration-meta"><strong>minutes</strong><small>{option.label}</small></span><span className="duration-check">✓</span></button>)}</div>;

  const whoPanel = <aside className="who-panel">
    <div className="who-head"><div className="hero-portrait"><img src={config.branding.avatarUrl} alt={config.name} /></div><div><strong className="who-name">{config.name}</strong><span className="eyebrow">Book a call</span></div></div>
    <h1>Choose a time for your meeting.</h1>
    {durationPicker}
    <ul className="who-facts">
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></svg>{config.videoProvider} link sent with the invite</li>
      <li><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>{config.timezoneLabel} · Mon–Fri, {hoursLabel}</li>
    </ul>
  </aside>;

  const pickPanels = <>
    <div className="month-panel"><div className="month-header"><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">←</button><h3>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">→</button></div><div className="weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div className="month-grid" aria-label="Choose an available date">{calendarDays.map((date) => { const status = statusFor(date); return <button key={date.toISOString()} type="button" disabled={status === "unavailable"} onClick={() => { setSelectedDate(date); setSelectedTime(null); setSelectedStartUk(null); }} className={`day ${status}-day ${date.getMonth() !== month.getMonth() ? "other-month" : ""} ${sameDate(displayedDate, date) ? "selected" : ""}`} aria-label={`${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${status}`}><span>{date.getDate()}</span><span className="availability-dots"><i></i>{status === "available" && <i></i>}</span></button>; })}</div><div className="calendar-legend"><span><i className="dot available"></i> Available</span><span><i className="dot limited"></i> Limited</span><span><i className="dot unavailable"></i> Unavailable</span></div></div>
    <div className="slots-panel"><div className="slots-heading"><div><span className="micro-label">Available times</span><h3>{displayedDate ? displayedDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }) : "Select a date"}</h3></div><span className="timezone">{zoneLabel}</span></div>{availabilityError ? <p className="slots-empty">{availabilityError}</p> : !availability ? <p className="slots-empty">Checking the calendar…</p> : displayedDate ? <div className="slots-grid">{slots.map(slot => <button type="button" className={`time-slot ${selectedStartUk === slot.startUk ? "picked" : ""}`} aria-pressed={selectedStartUk === slot.startUk} key={slot.startUk} onClick={() => pickSlot(slot)}>{slot.label}</button>)}</div> : <p className="slots-empty">Choose an available day to see times.</p>}{selectedTime && <button type="button" className="continue-button" onClick={openDetails}>Continue with {selectedTime}<span aria-hidden="true">→</span></button>}</div>
  </>;

  const detailsPanel = <div className="details-panel">{!result ? <form onSubmit={submitBooking}>
    <button type="button" className="back-link" onClick={() => setDetailsOpen(false)}><span aria-hidden="true">←</span> Change time</button>
    <h2 id="booking-title">Confirm your meeting.</h2>
    <div className="booking-summary"><strong>{longDate}</strong><br />{selectedTime} · {duration} minutes · {zoneLabel} · {config.videoProvider}</div>
    <fieldset className="topic-chips"><legend>What&apos;s it about?</legend>{meetingTopics.map((topic) => <label key={topic}><input type="radio" name="topic" value={topic} checked={guest.topic === topic} onChange={() => setGuest((current) => ({ ...current, topic }))} /><span>{topic}</span></label>)}</fieldset>
    <div className="details-row"><label>Full name<input name="name" autoComplete="name" required placeholder="Your name" {...field("name")} /></label><label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" {...field("email")} /></label></div>
    <label>Anything I should know beforehand?<textarea name="context" rows={3} placeholder="Optional" {...field("context")}></textarea></label>
    <TurnstileWidget siteKey={turnstileSiteKey} resetKey={turnstileResetKey} onToken={setTurnstileToken} onError={setTurnstileError} />{turnstileError && <p className="form-error">{turnstileError}</p>}{error && <p className="form-error">{error}</p>}
    <button className="confirm-button" disabled={submitting || !turnstileToken} type="submit">{submitting ? "Booking meeting…" : !turnstileToken ? "Checking browser…" : "Book this meeting"}<span>→</span></button>
    <p className="privacy-prompt">I use these details to arrange the meeting and keep a record of it. <a href="/privacy" target="_blank" rel="noreferrer">Read the privacy notice</a></p>
  </form> : <div className="success-panel"><span className="success-mark">✓</span><p className="section-kicker">Meeting booked</p><h2 id="booking-title">See you {longDate}.</h2><p>The invite is on its way to {guest.email}. Use this private link to reschedule or cancel.</p><a className="manage-link" href={result.manageUrl} target={embedded ? "_blank" : undefined} rel="noreferrer">Manage meeting →</a>{result.integrationStatus !== "connected" && <p className="form-note">The calendar invitation is still being created. {config.firstName} has been notified.</p>}</div>}</div>;

  const card = <div className={`booking-card ${detailsOpen ? "details-open" : ""}`}>{whoPanel}{detailsOpen ? detailsPanel : pickPanels}</div>;

  if (embedded) return <main ref={rootRef} className="booking-embed">{card}</main>;

  return <>
    <main id="top" ref={rootRef} className="booking-frame">
      <div className="frame-bar"><a href="https://mjeffries.com"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>mjeffries.com</a><span className="frame-note"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>Your details are only used to arrange this meeting.</span></div>
      {card}
      {showRates && <section className="rates-section"><div className="rates-copy"><p className="section-kicker">Rates</p><h2>Professional rates.</h2><p>These rates apply if we agree paid work after the meeting.</p></div><div className="rate-list"><div className="rate-row"><span className="rate-index">01</span><div><strong>{config.rates.hourly}</strong><span>per hour</span></div></div><div className="rate-row"><span className="rate-index">02</span><div><strong>{config.rates.professionalDay}</strong><span>per professional day</span></div></div><p className="rate-disclaimer">Booking a meeting is free. I will confirm any paid work separately.</p></div></section>}
      <a className="privacy-link" href="/privacy">Privacy</a>
    </main>
  </>;
}
