import { createDAVClient, type DAVCalendar } from "tsdav";
import { Agent } from "undici";
import rrule from "rrule";
const { rrulestr } = rrule;
import type { Session } from "./session.ts";
import { parseCalendar, type IcsEvent, buildEventIcs } from "./ics.ts";
import { parseVCard, type Contact } from "./vcard.ts";

type Dav = Awaited<ReturnType<typeof createDAVClient>>;

function makeFetch(insecure: boolean): typeof fetch {
  if (!insecure) return fetch;
  const agent = new Agent({ connect: { rejectUnauthorized: false } });
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, dispatcher: agent } as RequestInit)) as typeof fetch;
}

async function dav(kind: "caldav" | "carddav", url: string, s: Session): Promise<Dav> {
  const cached = kind === "caldav" ? s.calClient : s.cardClient;
  if (cached) return cached;
  const client = await createDAVClient({
    serverUrl: url,
    credentials: { username: s.email, password: s.password },
    authMethod: "Basic",
    defaultAccountType: kind,
    fetch: makeFetch(s.tlsInsecure),
  });
  if (kind === "caldav") s.calClient = client;
  else s.cardClient = client;
  return client;
}

export async function listCalendars(s: Session) {
  if (!s.caldav) throw Object.assign(new Error("No CalDAV URL configured"), { status: 400 });
  const client = await dav("caldav", s.caldav, s);
  const cals = await client.fetchCalendars();
  return cals.map((c: DAVCalendar) => ({
    url: c.url,
    displayName: String(c.displayName || c.url),
    ctag: c.ctag,
  }));
}

function expandEvent(event: IcsEvent, from: Date, to: Date): IcsEvent[] {
  if (!event.rrule) {
    const start = new Date(event.allDay ? event.dtstart + "T00:00:00" : event.dtstart);
    if (start < from || start > to) {
      if (event.dtend) {
        const end = new Date(event.allDay ? event.dtend + "T23:59:59" : event.dtend);
        if (end < from || start > to) return [];
      } else if (start < from || start > to) return [];
    }
    return [event];
  }
  try {
    const dtstart = new Date(event.allDay ? event.dtstart + "T00:00:00Z" : event.dtstart);
    const duration = event.dtend
      ? new Date(event.allDay ? event.dtend + "T00:00:00Z" : event.dtend).getTime() - dtstart.getTime()
      : 0;
    const rule = rrulestr(`RRULE:${event.rrule}`, { dtstart });
    return rule.between(from, to, true).map((d) => ({
      ...event,
      dtstart: event.allDay ? d.toISOString().slice(0, 10) : d.toISOString(),
      dtend: event.dtend
        ? event.allDay
          ? new Date(d.getTime() + duration).toISOString().slice(0, 10)
          : new Date(d.getTime() + duration).toISOString()
        : undefined,
    }));
  } catch {
    return [event];
  }
}

export async function listEvents(s: Session, calendarUrl: string, fromIso: string, toIso: string) {
  if (!s.caldav) throw Object.assign(new Error("No CalDAV URL configured"), { status: 400 });
  const client = await dav("caldav", s.caldav, s);
  const cals = await client.fetchCalendars();
  const calendar = cals.find((c) => c.url === calendarUrl) || cals[0];
  if (!calendar) throw Object.assign(new Error("Calendar not found"), { status: 404 });
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const objects = await client.fetchCalendarObjects({
    calendar,
    timeRange: { start: from.toISOString(), end: to.toISOString() },
  });
  const events: (IcsEvent & { url: string; etag?: string })[] = [];
  for (const obj of objects) {
    const parsed = parseCalendar(obj.data || "");
    for (const ev of parsed) {
      for (const occ of expandEvent(ev, from, to)) {
        events.push({ ...occ, url: obj.url, etag: obj.etag });
      }
    }
  }
  events.sort((a, b) => a.dtstart.localeCompare(b.dtstart));
  return events;
}

export async function createEvent(
  s: Session,
  calendarUrl: string,
  ev: {
    uid?: string;
    summary: string;
    description?: string;
    location?: string;
    dtstart: string;
    dtend?: string;
    allDay?: boolean;
  },
) {
  if (!s.caldav) throw Object.assign(new Error("No CalDAV URL configured"), { status: 400 });
  const client = await dav("caldav", s.caldav, s);
  const cals = await client.fetchCalendars();
  const calendar = cals.find((c) => c.url === calendarUrl) || cals[0];
  if (!calendar) throw Object.assign(new Error("Calendar not found"), { status: 404 });
  const uid = ev.uid || `${Date.now()}-${Math.random().toString(36).slice(2)}@hatsu`;
  const ics = buildEventIcs({ ...ev, uid });
  await client.createCalendarObject({ calendar, filename: `${uid}.ics`, iCalString: ics });
  return { uid, ics };
}

export async function putEvent(s: Session, calendarUrl: string, filename: string, ics: string) {
  if (!s.caldav) throw Object.assign(new Error("No CalDAV URL configured"), { status: 400 });
  const client = await dav("caldav", s.caldav, s);
  const cals = await client.fetchCalendars();
  const calendar = cals.find((c) => c.url === calendarUrl) || cals[0];
  if (!calendar) throw Object.assign(new Error("Calendar not found"), { status: 404 });
  await client.createCalendarObject({ calendar, filename, iCalString: ics });
}

export async function deleteEvent(s: Session, url: string) {
  if (!s.caldav) throw Object.assign(new Error("No CalDAV URL configured"), { status: 400 });
  const client = await dav("caldav", s.caldav, s);
  await client.deleteCalendarObject({ calendarObject: { url, etag: "" } });
}

export async function listContacts(s: Session): Promise<Contact[]> {
  if (!s.carddav) throw Object.assign(new Error("No CardDAV URL configured"), { status: 400 });
  const client = await dav("carddav", s.carddav, s);
  const books = await client.fetchAddressBooks();
  const contacts: Contact[] = [];
  for (const book of books) {
    const cards = await client.fetchVCards({ addressBook: book });
    for (const card of cards) {
      contacts.push(parseVCard(card.data || "", card.url));
    }
  }
  contacts.sort((a, b) => a.fn.localeCompare(b.fn));
  return contacts;
}
