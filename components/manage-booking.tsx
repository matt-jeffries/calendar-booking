"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { localDateKey, localTimeLabel, localZoneLabel, ukLocalToDate } from "@/lib/client-time";
import type { BookingUiConfig } from "@/lib/booking-config";

type Booking = { name: string; start_local: string; end_local: string; duration_minutes: number; status: string; meeting_url: string | null };
type AvailableSlot = { label: string; startUk: string };

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sameDate = (a: Date | null, b: Date) => Boolean(a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());

export default function ManageBooking({ token, config }: { token: string; config: BookingUiConfig }) {
  const today = useMemo(() => new Date(), []);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedStartUk, setSelectedStartUk] = useState<string | null>(null);
  const [availabilityState, setAvailabilityState] = useState<{ key: string; data: Record<string, AvailableSlot[]> | null; error: string }>({ key: "", data: null, error: "" });
  const zoneLabel = useSyncExternalStore(() => () => {}, localZoneLabel, () => "Your local time");

  const calendarDays = useMemo(() => {
    const offset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [month]);

  useEffect(() => {
    fetch(`/api/bookings/${token}`, { cache: "no-store" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setBooking(data.booking); })
      .catch(reason => setError(reason.message));
  }, [token]);

  const availabilityKey = useMemo(() => {
    if (!booking) return "";
    const from = dateKey(new Date(calendarDays[0].getFullYear(), calendarDays[0].getMonth(), calendarDays[0].getDate() - 1));
    const lastDay = calendarDays[calendarDays.length - 1];
    const to = dateKey(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1));
    return `${from}|${to}|${booking.duration_minutes}`;
  }, [booking, calendarDays]);
  const availability = availabilityState.key === availabilityKey ? availabilityState.data : null;
  const availabilityError = availabilityState.key === availabilityKey ? availabilityState.error : "";

  useEffect(() => {
    if (!rescheduleOpen || !booking) return;
    const controller = new AbortController();
    const from = dateKey(new Date(calendarDays[0].getFullYear(), calendarDays[0].getMonth(), calendarDays[0].getDate() - 1));
    const lastDay = calendarDays[calendarDays.length - 1];
    const to = dateKey(new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1));
    fetch(`/api/availability?from=${from}&to=${to}&duration=${booking.duration_minutes}`, {
      signal: controller.signal, cache: "no-store", headers: { "x-booking-token": token },
    }).then(async response => {
      const payload = await response.json() as { slots?: Array<{ startUk: string }>; error?: string };
      if (!response.ok || !payload.slots) throw new Error(payload.error ?? "Availability could not be loaded.");
      const grouped: Record<string, AvailableSlot[]> = {};
      for (const slot of payload.slots) {
        const instant = ukLocalToDate(slot.startUk);
        (grouped[localDateKey(instant)] ??= []).push({ label: localTimeLabel(instant), startUk: slot.startUk });
      }
      setAvailabilityState({ key: availabilityKey, data: grouped, error: "" });
    }).catch((reason: Error) => { if (reason.name !== "AbortError") setAvailabilityState({ key: availabilityKey, data: null, error: reason.message }); });
    return () => controller.abort();
  }, [availabilityKey, booking, calendarDays, rescheduleOpen, token]);

  const slots = selectedDate ? availability?.[dateKey(selectedDate)] ?? [] : [];
  const dateStatus = (date: Date) => {
    const floorToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (date < floorToday) return "unavailable";
    const count = availability?.[dateKey(date)]?.length ?? 0;
    if (!count) return "unavailable";
    return count < 6 ? "limited" : "available";
  };

  async function update(action: "cancel" | "reschedule") {
    setBusy(true); setError("");
    const response = await fetch(`/api/bookings/${token}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...(action === "reschedule" ? { startLocal: selectedStartUk } : {}) }),
    });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error); return; }
    setBooking(data.booking);
    if (action === "reschedule") setRescheduleOpen(false);
  }

  return <>
    <main className="manage-page">
      <Link className="manage-home" href="/">← {config.name}</Link>
      <section className="manage-card">
        <div className="hero-portrait small"><img src={config.branding.avatarUrl} alt={config.name} /></div>
        <p className="section-kicker">Manage your meeting</p>
        {error && !booking ? <><h1>We couldn’t find that booking.</h1><p>{error}</p></> : !booking ? <h1>Loading your booking…</h1> : <>
          <h1>{booking.status === "cancelled" ? "This meeting is cancelled." : `Your meeting with ${config.firstName}.`}</h1>
          <div className="manage-summary"><span>Date and time</span><strong>{booking.start_local.replace("T", " at ").slice(0, 16)} {config.timezoneLabel}</strong><span>Length</span><strong>{booking.duration_minutes} minutes</strong>{booking.meeting_url && <><span>Video</span><a href={booking.meeting_url}>Join {config.videoProvider}</a></>}</div>
          {booking.status !== "cancelled" && <><button className="confirm-button reschedule-launch" onClick={() => { setError(""); setSelectedDate(null); setSelectedStartUk(null); setAvailabilityState({ key: "", data: null, error: "" }); setRescheduleOpen(true); }}>Reschedule this meeting <span>→</span></button><button className="cancel-button" disabled={busy} onClick={() => update("cancel")}>Cancel this meeting</button></>}
          {error && <p className="form-error">{error}</p>}
        </>}
      </section>
    </main>
    {rescheduleOpen && booking && <div className="modal-backdrop"><div className="booking-modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
      <button className="dialog-close" onClick={() => setRescheduleOpen(false)} aria-label="Close">×</button>
      <p className="section-kicker">Reschedule</p><h2 id="reschedule-title">Choose a new time.</h2>
      <div className="reschedule-calendar">
        <div className="month-panel"><div className="month-header"><button className="icon-button" onClick={() => { setSelectedDate(null); setSelectedStartUk(null); setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); }} aria-label="Previous month">←</button><h3>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3><button className="icon-button" onClick={() => { setSelectedDate(null); setSelectedStartUk(null); setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); }} aria-label="Next month">→</button></div><div className="weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div><div className="month-grid" aria-label="Choose an available date">{calendarDays.map(date => { const status = dateStatus(date); return <button key={date.toISOString()} type="button" disabled={status === "unavailable"} onClick={() => { setSelectedDate(date); setSelectedStartUk(null); }} className={`day ${status}-day ${date.getMonth() !== month.getMonth() ? "other-month" : ""} ${sameDate(selectedDate, date) ? "selected" : ""}`} aria-label={`${date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}, ${status}`}><span>{date.getDate()}</span><span className="availability-dots"><i></i>{status === "available" && <i></i>}</span></button>; })}</div></div>
        <div className="slots-panel"><div className="slots-heading"><div><span className="micro-label">Available times</span><h3>{selectedDate ? selectedDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }) : "Select a date"}</h3></div><span className="timezone">{zoneLabel}</span></div>{availabilityError ? <p className="slots-empty">{availabilityError}</p> : !availability ? <p className="slots-empty">Checking the calendar…</p> : selectedDate ? <div className="slots-grid">{slots.map(slot => <button type="button" className={`time-slot ${selectedStartUk === slot.startUk ? "selected-time" : ""}`} key={slot.startUk} onClick={() => setSelectedStartUk(slot.startUk)}>{slot.label}</button>)}</div> : <p className="slots-empty">Choose an available day to see times.</p>}</div>
      </div>
      <button className="confirm-button" disabled={busy || !selectedStartUk} onClick={() => update("reschedule")}>{busy ? "Updating…" : "Confirm new time"}<span>→</span></button>
      {error && <p className="form-error">{error}</p>}
    </div></div>}
  </>;
}
