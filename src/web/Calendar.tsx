import { useEffect, useMemo, useState } from "react";
import { api, fmtDate, type CalEvent, type CalendarInfo } from "./api";

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  return ymd(d);
}

export function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(ymd(new Date()));
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [calendar, setCalendar] = useState("");
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [err, setErr] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [summary, setSummary] = useState("");
  const [location, setLocation] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function loadCals() {
    try {
      const { calendars: c } = await api.calendars();
      setCalendars(c);
      if (!calendar && c[0]) setCalendar(c[0].url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadEvents(url = calendar, month = cursor) {
    if (!url) return;
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
    const { events: ev } = await api.events(url, from.toISOString(), to.toISOString());
    setEvents(ev);
  }

  useEffect(() => {
    loadCals();
  }, []);

  useEffect(() => {
    if (calendar) loadEvents(calendar, cursor).catch((e) => setErr(e.message));
  }, [calendar, cursor]);

  const cells = useMemo(() => {
    const first = startOfMonth(cursor);
    const startWeek = (first.getDay() + 6) % 7; // Monday
    const days: { date: Date; inMonth: boolean }[] = [];
    const begin = new Date(first);
    begin.setDate(1 - startWeek);
    for (let i = 0; i < 42; i++) {
      const d = new Date(begin);
      d.setDate(begin.getDate() + i);
      days.push({ date: d, inMonth: d.getMonth() === cursor.getMonth() });
    }
    return days;
  }, [cursor]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = eventDay(e.dtstart);
      m.set(k, [...(m.get(k) || []), e]);
    }
    return m;
  }, [events]);

  const dayEvents = byDay.get(selected) || [];

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    try {
      await api.createEvent({
        calendar,
        summary,
        location: location || undefined,
        allDay,
        dtstart: allDay ? selected : start || `${selected}T09:00:00`,
        dtend: allDay ? undefined : end || undefined,
      });
      setShowNew(false);
      setSummary("");
      await loadEvents();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (err && !calendars.length) {
    return (
      <div className="empty">
        <div>
          <p>{err}</p>
          <p className="note">Add a CalDAV URL under Settings to see a calendar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cal">
      <div className="cal-main">
        <div className="cal-head">
          <button className="btn ghost small" onClick={() => setCursor(addMonths(cursor, -1))}>
            ‹
          </button>
          <h2>
            {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
          </h2>
          <button className="btn ghost small" onClick={() => setCursor(addMonths(cursor, 1))}>
            ›
          </button>
          <select value={calendar} onChange={(e) => setCalendar(e.target.value)}>
            {calendars.map((c) => (
              <option key={c.url} value={c.url}>
                {c.displayName}
              </option>
            ))}
          </select>
          <button className="btn small seal" onClick={() => setShowNew(true)}>
            New
          </button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="dow">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="grid-cal">
          {cells.map(({ date, inMonth }) => {
            const key = ymd(date);
            const list = byDay.get(key) || [];
            return (
              <button
                key={key}
                className={`cell ${inMonth ? "" : "out"} ${selected === key ? "on" : ""}`}
                onClick={() => setSelected(key)}
              >
                <div className="n">{date.getDate()}</div>
                {list.slice(0, 3).map((e) => (
                  <span className="pill" key={e.uid + e.dtstart}>
                    {e.summary}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
      <aside className="side">
        <h3>{selected}</h3>
        {!dayEvents.length && <p className="note">Nothing on this day.</p>}
        {dayEvents.map((e) => (
          <div className="card" key={e.uid + e.dtstart} style={{ marginBottom: "0.6rem" }}>
            <h3>{e.summary}</h3>
            <div className="note">{e.allDay ? "All day" : fmtDate(e.dtstart)}</div>
            {e.location && <div>{e.location}</div>}
            {e.description && <p className="note">{e.description}</p>}
            {e.url && (
              <button className="btn ghost small" onClick={() => api.deleteEvent(e.url!).then(() => loadEvents())}>
                Delete
              </button>
            )}
          </div>
        ))}
        {showNew && (
          <form onSubmit={create} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h3>New event</h3>
            <label className="field">
              <span>Title</span>
              <input value={summary} onChange={(e) => setSummary(e.target.value)} required />
            </label>
            <label className="field">
              <span>Location</span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>
            {!allDay && (
              <>
                <label className="field">
                  <span>Starts</span>
                  <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
                </label>
                <label className="field">
                  <span>Ends</span>
                  <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
                </label>
              </>
            )}
            <div className="row">
              <button className="btn small" type="submit">
                Save
              </button>
              <button className="btn ghost small" type="button" onClick={() => setShowNew(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
