/** Minimal iCalendar (RFC 5545 / iTIP) parse and build. */

export type IcsAttendee = {
  email: string;
  cn?: string;
  partstat?: string;
  role?: string;
  rsvp?: boolean;
};

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  allDay?: boolean;
  tzid?: string;
  organizer?: { email: string; cn?: string };
  attendees: IcsAttendee[];
  rrule?: string;
  sequence?: number;
  method?: string;
  status?: string;
  raw: string;
};

type IcsLine = { name: string; params: Record<string, string>; value: string };

export function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function parseLines(ics: string): IcsLine[] {
  const text = unfold(ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const lines: IcsLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw || raw.startsWith(" ")) continue;
    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    const left = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    const parts = left.split(";");
    const name = parts[0].toUpperCase();
    const params: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq < 0) continue;
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    lines.push({ name, params, value });
  }
  return lines;
}

function unescape(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function mailto(value: string): string {
  return value.replace(/^mailto:/i, "").trim();
}

function parseDate(value: string, params: Record<string, string>): { iso: string; allDay: boolean; tzid?: string } {
  const v = value.trim();
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, allDay: true };
  }
  const z = v.endsWith("Z");
  const t = v.replace(/Z$/, "");
  const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11) || "00"}:${t.slice(11, 13) || "00"}:${t.slice(13, 15) || "00"}${z ? "Z" : ""}`;
  return { iso, allDay: false, tzid: params.TZID };
}

function parsePerson(value: string, params: Record<string, string>): { email: string; cn?: string } {
  return { email: mailto(value), cn: params.CN ? unquote(params.CN) : undefined };
}

function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1");
}

export function parseCalendar(ics: string): IcsEvent[] {
  const lines = parseLines(ics);
  const method = lines.find((l) => l.name === "METHOD")?.value.toUpperCase();
  const events: IcsEvent[] = [];
  let cur: IcsLine[] | null = null;
  for (const line of lines) {
    if (line.name === "BEGIN" && line.value === "VEVENT") {
      cur = [];
      continue;
    }
    if (line.name === "END" && line.value === "VEVENT") {
      if (cur) {
        const ev = linesToEvent(cur, method, ics);
        if (ev) events.push(ev);
      }
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return events;
}

function linesToEvent(lines: IcsLine[], method: string | undefined, raw: string): IcsEvent | null {
  const uid = lines.find((l) => l.name === "UID")?.value;
  if (!uid) return null;
  const startLine = lines.find((l) => l.name === "DTSTART");
  const endLine = lines.find((l) => l.name === "DTEND");
  const start = startLine ? parseDate(startLine.value, startLine.params) : { iso: new Date().toISOString(), allDay: false };
  const end = endLine ? parseDate(endLine.value, endLine.params) : undefined;
  const orgLine = lines.find((l) => l.name === "ORGANIZER");
  const attendees: IcsAttendee[] = lines.filter((l) => l.name === "ATTENDEE").map((l) => {
    const p = parsePerson(l.value, l.params);
    return {
      ...p,
      partstat: l.params.PARTSTAT?.toUpperCase(),
      role: l.params.ROLE,
      rsvp: l.params.RSVP === "TRUE",
    };
  });
  const duration = lines.find((l) => l.name === "DURATION")?.value;
  let dtend = end?.iso;
  if (!dtend && duration && startLine) {
    dtend = addDuration(start.iso, duration, start.allDay);
  }
  return {
    uid,
    summary: unescape(lines.find((l) => l.name === "SUMMARY")?.value || "(no title)"),
    description: unescape(lines.find((l) => l.name === "DESCRIPTION")?.value || "") || undefined,
    location: unescape(lines.find((l) => l.name === "LOCATION")?.value || "") || undefined,
    dtstart: start.iso,
    dtend,
    allDay: start.allDay,
    tzid: start.tzid,
    organizer: orgLine ? parsePerson(orgLine.value, orgLine.params) : undefined,
    attendees,
    rrule: lines.find((l) => l.name === "RRULE")?.value,
    sequence: Number(lines.find((l) => l.name === "SEQUENCE")?.value || "0"),
    method,
    status: lines.find((l) => l.name === "STATUS")?.value,
    raw,
  };
}

function addDuration(iso: string, duration: string, allDay: boolean): string {
  const m = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return iso;
  const d = allDay ? new Date(iso + "T00:00:00Z") : new Date(iso);
  d.setUTCDate(d.getUTCDate() + Number(m[1] || 0));
  d.setUTCHours(d.getUTCHours() + Number(m[2] || 0));
  d.setUTCMinutes(d.getUTCMinutes() + Number(m[3] || 0));
  d.setUTCSeconds(d.getUTCSeconds() + Number(m[4] || 0));
  if (allDay) return d.toISOString().slice(0, 10);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  let out = "";
  let i = 0;
  let first = true;
  while (i < bytes.length) {
    const take = first ? 75 : 74;
    let end = Math.min(i + take, bytes.length);
    while (end > i && (bytes[end - 1] & 0xc0) === 0x80) end--;
    if (end === i) end = Math.min(i + take, bytes.length);
    const chunk = bytes.subarray(i, end).toString("utf8");
    out += (first ? "" : "\r\n ") + chunk;
    first = false;
    i = end;
  }
  return out;
}

function prop(name: string, value: string, params?: Record<string, string>): string {
  const p = params
    ? Object.entries(params)
        .filter(([, v]) => v)
        .map(([k, v]) => `;${k}=${/[;,:]/.test(v) ? `"${v}"` : v}`)
        .join("")
    : "";
  return foldLine(`${name}${p}:${value}`);
}

function stamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function toIcsDate(iso: string, allDay?: boolean): { name: string; value: string; params?: Record<string, string> } {
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { name: "DTSTART", value: iso.replace(/-/g, ""), params: { VALUE: "DATE" } };
  }
  const d = iso.endsWith("Z") || iso.includes("+") ? new Date(iso) : new Date(iso + "Z");
  return { name: "DTSTART", value: stamp(d) };
}

export function buildEventIcs(ev: {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  allDay?: boolean;
  organizer?: { email: string; cn?: string };
  attendees?: IcsAttendee[];
  rrule?: string;
  method?: string;
  partstatSelf?: { email: string; partstat: string };
  prodid?: string;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    prop("PRODID", ev.prodid || "-//Hatsu//EN"),
    "CALSCALE:GREGORIAN",
  ];
  if (ev.method) lines.push(prop("METHOD", ev.method));
  lines.push("BEGIN:VEVENT");
  lines.push(prop("UID", ev.uid));
  lines.push(prop("DTSTAMP", stamp()));
  const start = toIcsDate(ev.dtstart, ev.allDay);
  lines.push(prop(start.name, start.value, start.params));
  if (ev.dtend) {
    const end = toIcsDate(ev.dtend, ev.allDay);
    lines.push(prop("DTEND", end.value, end.params));
  }
  lines.push(prop("SUMMARY", escape(ev.summary)));
  if (ev.description) lines.push(prop("DESCRIPTION", escape(ev.description)));
  if (ev.location) lines.push(prop("LOCATION", escape(ev.location)));
  if (ev.rrule) lines.push(prop("RRULE", ev.rrule));
  if (ev.organizer) {
    lines.push(prop("ORGANIZER", `mailto:${ev.organizer.email}`, ev.organizer.cn ? { CN: ev.organizer.cn } : undefined));
  }
  const attendees = [...(ev.attendees || [])];
  if (ev.partstatSelf) {
    const i = attendees.findIndex((a) => a.email.toLowerCase() === ev.partstatSelf!.email.toLowerCase());
    if (i >= 0) attendees[i] = { ...attendees[i], partstat: ev.partstatSelf.partstat };
    else attendees.push({ email: ev.partstatSelf.email, partstat: ev.partstatSelf.partstat, role: "REQ-PARTICIPANT" });
  }
  for (const a of attendees) {
    lines.push(
      prop("ATTENDEE", `mailto:${a.email}`, {
        CN: a.cn || "",
        PARTSTAT: a.partstat || "NEEDS-ACTION",
        ROLE: a.role || "REQ-PARTICIPANT",
        RSVP: a.rsvp ? "TRUE" : "",
      }),
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

export function replyIcs(event: IcsEvent, attendeeEmail: string, partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE"): string {
  return buildEventIcs({
    uid: event.uid,
    summary: event.summary,
    dtstart: event.dtstart,
    dtend: event.dtend,
    allDay: event.allDay,
    organizer: event.organizer,
    attendees: event.attendees,
    method: "REPLY",
    partstatSelf: { email: attendeeEmail, partstat },
  });
}

export function storeIcs(event: IcsEvent, attendeeEmail: string, partstat: "ACCEPTED" | "DECLINED" | "TENTATIVE"): string {
  return buildEventIcs({
    uid: event.uid,
    summary: event.summary,
    description: event.description,
    location: event.location,
    dtstart: event.dtstart,
    dtend: event.dtend,
    allDay: event.allDay,
    organizer: event.organizer,
    attendees: event.attendees,
    rrule: event.rrule,
    partstatSelf: { email: attendeeEmail, partstat },
  });
}
