export type Addr = { name?: string; address: string };
export type ServerCfg = { host: string; port: number; secure: boolean };

export type SessionInfo = {
  email: string;
  name?: string;
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  davUser?: string;
  davSeparate: boolean;
  tlsInsecure: boolean;
};

export type Discovery = {
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  notes: string[];
};

export type AppDefaults = Discovery & {
  demo: boolean;
  email?: string;
  tlsInsecure: boolean;
};

export type Mailbox = {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  flags: string[];
  messages?: number;
  unseen?: number;
};

export type MessageSummary = {
  uid: number;
  flags: string[];
  date?: string;
  size?: number;
  subject: string;
  from: Addr[];
  to: Addr[];
  hasAttachment: boolean;
};

export type Message = {
  uid: number;
  flags: string[];
  date?: string;
  subject: string;
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  replyTo: Addr[];
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  text: string;
  html?: string;
  attachments: { filename: string; contentType: string; size: number }[];
  pgp: { encrypted: boolean; signed: boolean; armored?: string; cleartext?: string };
  invite?: {
    uid: string;
    summary: string;
    dtstart: string;
    dtend?: string;
    allDay?: boolean;
    location?: string;
    organizer?: Addr;
    method?: string;
    ics: string;
  };
};

export type CalendarInfo = { url: string; displayName: string };
export type CalEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  allDay?: boolean;
  url?: string;
  rrule?: string;
};
export type Contact = {
  uid: string;
  fn: string;
  emails: string[];
  keys: { type?: string; value: string }[];
};

export type LookedUpKey = {
  armored: string;
  fingerprint: string;
  userIDs: string[];
  source: "wkd" | "hkp";
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean }>("/api/health"),
  defaults: () => req<AppDefaults | null>("/api/defaults"),
  discover: (email: string) => req<Discovery>("/api/discover", { method: "POST", body: JSON.stringify({ email }) }),
  login: (body: {
    email: string;
    password: string;
    name?: string;
    imap?: Partial<ServerCfg>;
    smtp?: Partial<ServerCfg>;
    caldav?: string;
    carddav?: string;
    davUser?: string;
    davPassword?: string;
    davSeparate?: boolean;
    tlsInsecure?: boolean;
  }) => req<SessionInfo>("/api/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () => req("/api/logout", { method: "POST" }),
  session: () => req<SessionInfo>("/api/session"),
  settings: (body: {
    caldav?: string;
    carddav?: string;
    name?: string;
    davUser?: string;
    davPassword?: string;
    davSeparate?: boolean;
  }) => req<SessionInfo>("/api/settings", { method: "POST", body: JSON.stringify(body) }),
  mailboxes: () => req<{ mailboxes: Mailbox[] }>("/api/mailboxes"),
  messages: (mailbox: string, page = 1, q?: string) =>
    req<{ messages: MessageSummary[]; exists: number; unseen?: number; page: number; limit: number }>(
      `/api/messages?mailbox=${encodeURIComponent(mailbox)}&page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    ),
  message: (mailbox: string, uid: number) =>
    req<Message>(`/api/message?mailbox=${encodeURIComponent(mailbox)}&uid=${uid}`),
  flags: (mailbox: string, uid: number, add: string[] = [], remove: string[] = []) =>
    req("/api/flags", { method: "POST", body: JSON.stringify({ mailbox, uid, add, remove }) }),
  move: (mailbox: string, uid: number, target: string) =>
    req("/api/move", { method: "POST", body: JSON.stringify({ mailbox, uid, target }) }),
  delete: (mailbox: string, uid: number) =>
    req("/api/delete", { method: "POST", body: JSON.stringify({ mailbox, uid }) }),
  send: (body: unknown) => req<{ messageId: string }>("/api/send", { method: "POST", body: JSON.stringify(body) }),
  lookupKey: (email: string) => req<{ key: LookedUpKey | null }>(`/api/keys/lookup?email=${encodeURIComponent(email)}`),
  calendars: () => req<{ calendars: CalendarInfo[] }>("/api/calendars"),
  events: (calendar: string, from: string, to: string) =>
    req<{ events: CalEvent[] }>(
      `/api/events?calendar=${encodeURIComponent(calendar)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  createEvent: (body: {
    calendar: string;
    summary: string;
    description?: string;
    location?: string;
    dtstart: string;
    dtend?: string;
    allDay?: boolean;
  }) => req("/api/events", { method: "POST", body: JSON.stringify(body) }),
  deleteEvent: (url: string) => req(`/api/events?url=${encodeURIComponent(url)}`, { method: "DELETE" }),
  contacts: () => req<{ contacts: Contact[] }>("/api/contacts"),
  inviteRespond: (body: { mailbox: string; uid: number; action: "accept" | "decline" | "tentative"; calendarUrl?: string }) =>
    req("/api/invite/respond", { method: "POST", body: JSON.stringify(body) }),
};

export function fmtAddr(a: Addr): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}
