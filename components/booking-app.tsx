"use client";

import { FormEvent, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { BookingUiConfig } from "@/lib/booking-config";
import { localDateKey, localTimeLabel, localZoneLabel, ukLocalToDate } from "@/lib/client-time";
import TurnstileWidget from "@/components/turnstile-widget";

type Props = {
  config: BookingUiConfig;
  fixedDuration?: 30 | 60;
  showRates: boolean;
  turnstileSiteKey: string | null;
};
type Result = { manageUrl: string; meetingUrl: string | null; integrationStatus: string };
type AvailableSlot = { label: string; startUk: string };
const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const minutesFromTime = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const sameDate = (a: Date | null, b: Date) => Boolean(a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());

export default function BookingApp({ config, fixedDuration, showRates, turnstileSiteKey }: Props) {
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [duration, setDuration] = useState<number>(fixedDuration ?? config.meetingDurations[0].minutes);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [selectedStartUk, setSelectedStartUk] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [availabilityState, setAvailabilityState] = useState<{ key: string; data: Record<string, AvailableSlot[]> | null; error: string }>({ key: "", data: null, error: "" });
  const zoneLabel = useSyncExternalStore(() => () => {}, localZoneLabel, () => "Your local time");

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
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: data.get("name"), email: data.get("email"), context: data.get("context"), startLocal: selectedStartUk, duration, turnstileToken }),
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

  return <>
    <main id="top">
      <section className="hero"><div className="hero-portrait"><img src={config.branding.avatarUrl} alt={config.name} /></div><div className="hero-name">{config.name}</div><div className="eyebrow">Book a meeting with me</div><h1>Choose a time<br />for your meeting.</h1><a className="hero-link" href="#booking">View available times <span aria-hidden="true">↓</span></a><div className="hero-orbit orbit-one"></div><div className="hero-orbit orbit-two"></div></section>
      <section className="booking-shell" id="booking">
        <div className="booking-intro"><div><p className="section-kicker">Book a meeting</p><h2>{fixedDuration ? `Choose a time for a ${fixedDuration}-minute meeting` : "Choose a meeting length"}</h2></div></div>
        {!fixedDuration && <div className="duration-picker" role="radiogroup" aria-label="Meeting length">{config.meetingDurations.map((option) => <button key={option.minutes} className={`duration ${duration === option.minutes ? "active" : ""}`} onClick={() => setDuration(option.minutes)} role="radio" aria-checked={duration === option.minutes}><span className="duration-time">{option.minutes}</span><span className="duration-meta"><strong>minutes</strong><small>{option.label}</small></span><span className="duration-check">✓</span></button>)}</div>}
        <div className="calendar-card">
          <div className="month-panel"><div className="month-header"><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">←</button><h3>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3><button className="icon-button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">→</button></div><div className="weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div className="month-grid" aria-label="Choose an available date">{calendarDays.map((date) => { const status = statusFor(date); return <button key={date.toISOString()} type="button" disabled={status === "unavailable"} onClick={() => setSelectedDate(date)} className={`day ${status}-day ${date.getMonth() !== month.getMonth() ? "other-month" : ""} ${sameDate(displayedDate, date) ? "selected" : ""}`} aria-label={`${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${status}`}><span>{date.getDate()}</span><span className="availability-dots"><i></i>{status === "available" && <i></i>}</span></button>; })}</div><div className="calendar-legend"><span><i className="dot available"></i> Available</span><span><i className="dot limited"></i> Limited</span><span><i className="dot unavailable"></i> Unavailable</span></div></div>
          <div className="slots-panel"><div className="slots-heading"><div><span className="micro-label">Available times</span><h3>{displayedDate ? displayedDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }) : "Select a date"}</h3></div><span className="timezone">{zoneLabel}</span></div>{availabilityError ? <p className="slots-empty">{availabilityError}</p> : !availability ? <p className="slots-empty">Checking the calendar…</p> : displayedDate ? <div className="slots-grid">{slots.map(slot => <button className="time-slot" key={slot.startUk} onClick={() => { setSelectedDate(displayedDate); setSelectedTime(slot.label); setSelectedStartUk(slot.startUk); setDialogOpen(true); setResult(null); setError(""); setTurnstileToken(""); setTurnstileError(""); }}>{slot.label}</button>)}</div> : <p className="slots-empty">Choose an available day to see times.</p>}</div>
        </div>
      </section>
      {showRates && <section className="rates-section"><div className="rates-copy"><p className="section-kicker">Rates</p><h2>Professional rates.</h2><p>These rates apply if we agree paid work after the meeting.</p></div><div className="rate-list"><div className="rate-row"><span className="rate-index">01</span><div><strong>{config.rates.hourly}</strong><span>per hour</span></div></div><div className="rate-row"><span className="rate-index">02</span><div><strong>{config.rates.professionalDay}</strong><span>per professional day</span></div></div><p className="rate-disclaimer">Booking a meeting is free. I will confirm any paid work separately.</p></div></section>}
      <a className={`privacy-link ${showRates ? "" : "rates-hidden"}`} href="/privacy">Privacy</a>
    </main>
    {dialogOpen && <div className="modal-backdrop" role="presentation"><div className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title"><button className="dialog-close" onClick={() => setDialogOpen(false)} aria-label="Close">×</button>{!result ? <form onSubmit={submitBooking}><p className="section-kicker">Your details</p><h2 id="booking-title">Confirm your meeting.</h2><div className="booking-summary"><strong>{displayedDate?.toLocaleDateString(config.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><br />{selectedTime} · {duration} minutes · {zoneLabel} · {config.videoProvider}</div><label>Full name<input name="name" autoComplete="name" required placeholder="Your name" /></label><label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label><label>What would you like to discuss?<textarea name="context" rows={3} placeholder={`Add anything ${config.firstName} should know before the meeting`}></textarea></label><TurnstileWidget siteKey={turnstileSiteKey} resetKey={turnstileResetKey} onToken={setTurnstileToken} onError={setTurnstileError} />{turnstileError && <p className="form-error">{turnstileError}</p>}{error && <p className="form-error">{error}</p>}<button className="confirm-button" disabled={submitting || !turnstileToken} type="submit">{submitting ? "Booking meeting…" : !turnstileToken ? "Checking browser…" : "Book this meeting"}<span>→</span></button><p className="privacy-prompt">I use these details to arrange the meeting and keep a record of it. <a href="/privacy" target="_blank" rel="noreferrer">Read the privacy notice</a></p></form> : <div className="success-panel"><span className="success-mark">✓</span><p className="section-kicker">Meeting booked</p><h2 id="booking-title">Your meeting is booked.</h2><p>Use this private link to reschedule or cancel.</p><a className="manage-link" href={result.manageUrl}>Manage meeting →</a>{result.integrationStatus !== "connected" && <p className="form-note">The calendar invitation is still being created. {config.firstName} has been notified.</p>}</div>}</div></div>}
  </>;
}
