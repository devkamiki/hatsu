import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discover, mergeServer } from "./discover.ts";
import { parseCalendar, replyIcs, storeIcs } from "./ics.ts";
import { lookupKey } from "./keys.ts";
import {
  downloadAttachment,
  getMessage,
  listMailboxes,
  listMessages,
  moveMessage,
  sendMail,
  setFlags,
  specialFolder,
} from "./mail.ts";
import { createEvent, deleteEvent, listCalendars, listContacts, listEvents, putEvent } from "./dav.ts";
import { createSession, destroySession, getSession, publicSession, verifyImap, type Session } from "./session.ts";
import type { SendBody } from "./mail.ts";
import type { LoginBody } from "./types.ts";
import type { Context } from "hono";

const COOKIE = "hatsu";
const PORT = Number(process.env.HATSU_PORT || 8080);
const loginAttempts = new Map<string, number[]>();

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
});

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("cf-connecting-ip") || "local";
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const window = 5 * 60 * 1000;
  const hits = (loginAttempts.get(ip) || []).filter((t) => now - t < window);
  hits.push(now);
  loginAttempts.set(ip, hits);
  return hits.length > 15;
}

function requireSession(c: Context): Session {
  const id = getCookie(c, COOKIE);
  const s = getSession(id);
  if (!s) throw new HTTPException(401, { message: "Not signed in" });
  return s;
}

function fail(err: unknown): never {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  const code = status && status >= 400 && status < 600 ? status : 500;
  throw new HTTPException(code as 500, { message });
}

app.get("/api/health", (c) => c.json({ ok: true, name: "hatsu" }));

app.post("/api/discover", async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email || !email.includes("@")) throw new HTTPException(400, { message: "email required" });
  try {
    return c.json(await discover(email));
  } catch (err) {
    fail(err);
  }
});

app.post("/api/login", async (c) => {
  if (rateLimit(clientIp(c))) throw new HTTPException(429, { message: "Too many login attempts" });
  const body = (await c.req.json()) as LoginBody;
  if (!body.email || !body.password) throw new HTTPException(400, { message: "email and password required" });
  const guessed = await discover(body.email).catch(() => null);
  const imap = mergeServer(body.imap, guessed?.imap || { host: "", port: 993, secure: true });
  const smtp = mergeServer(body.smtp, guessed?.smtp || { host: "", port: 587, secure: false });
  if (!imap.host || !smtp.host) throw new HTTPException(400, { message: "IMAP and SMTP hosts are required" });
  try {
    await verifyImap(imap, body.email, body.password, !!body.tlsInsecure);
  } catch (err) {
    const e = err as { message?: string; responseText?: string; authenticationFailed?: boolean; code?: string };
    const hint = e.authenticationFailed || /auth|login|failed/i.test(e.message || "")
      ? "Wrong email or password, or this host needs an app password."
      : e.responseText || e.message || String(err);
    throw new HTTPException(401, { message: `IMAP login failed: ${hint}` });
  }
  const session = createSession({
    email: body.email,
    name: body.name,
    password: body.password,
    imap,
    smtp,
    caldav: body.caldav || guessed?.caldav,
    carddav: body.carddav || guessed?.carddav,
    tlsInsecure: !!body.tlsInsecure,
  });
  setCookie(c, COOKIE, session.id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 12,
    secure: c.req.url.startsWith("https:"),
  });
  return c.json(publicSession(session));
});

app.post("/api/logout", async (c) => {
  const id = getCookie(c, COOKIE);
  if (id) await destroySession(id);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/session", (c) => {
  const s = requireSession(c);
  return c.json(publicSession(s));
});

app.post("/api/settings", async (c) => {
  const s = requireSession(c);
  const body = await c.req.json<{ caldav?: string; carddav?: string; name?: string }>();
  if (body.caldav !== undefined) {
    s.caldav = body.caldav || undefined;
    s.calClient = undefined;
  }
  if (body.carddav !== undefined) {
    s.carddav = body.carddav || undefined;
    s.cardClient = undefined;
  }
  if (body.name !== undefined) s.name = body.name;
  return c.json(publicSession(s));
});

app.get("/api/mailboxes", async (c) => {
  const s = requireSession(c);
  try {
    return c.json({ mailboxes: await listMailboxes(s) });
  } catch (err) {
    fail(err);
  }
});

app.get("/api/messages", async (c) => {
  const s = requireSession(c);
  const mailbox = c.req.query("mailbox") || "INBOX";
  const page = Number(c.req.query("page") || "1");
  const q = c.req.query("q") || undefined;
  try {
    return c.json(await listMessages(s, mailbox, { page, q }));
  } catch (err) {
    fail(err);
  }
});

app.get("/api/message", async (c) => {
  const s = requireSession(c);
  const mailbox = c.req.query("mailbox") || "INBOX";
  const uid = Number(c.req.query("uid"));
  if (!uid) throw new HTTPException(400, { message: "uid required" });
  try {
    return c.json(await getMessage(s, mailbox, uid));
  } catch (err) {
    fail(err);
  }
});

app.get("/api/attachment", async (c) => {
  const s = requireSession(c);
  const mailbox = c.req.query("mailbox") || "INBOX";
  const uid = Number(c.req.query("uid"));
  const filename = c.req.query("filename") || "";
  try {
    const att = await downloadAttachment(s, mailbox, uid, filename);
    return new Response(Uint8Array.from(att.body), {
      headers: {
        "Content-Type": att.contentType,
        "Content-Disposition": `attachment; filename="${att.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (err) {
    fail(err);
  }
});

app.post("/api/flags", async (c) => {
  const s = requireSession(c);
  const { mailbox, uid, add, remove } = await c.req.json<{
    mailbox: string;
    uid: number;
    add?: string[];
    remove?: string[];
  }>();
  try {
    await setFlags(s, mailbox, uid, add, remove);
    return c.json({ ok: true });
  } catch (err) {
    fail(err);
  }
});

app.post("/api/move", async (c) => {
  const s = requireSession(c);
  const { mailbox, uid, target } = await c.req.json<{ mailbox: string; uid: number; target: string }>();
  try {
    await moveMessage(s, mailbox, uid, target);
    return c.json({ ok: true });
  } catch (err) {
    fail(err);
  }
});

app.post("/api/delete", async (c) => {
  const s = requireSession(c);
  const { mailbox, uid } = await c.req.json<{ mailbox: string; uid: number }>();
  try {
    const boxes = await listMailboxes(s);
    const trash = specialFolder(boxes, "\\Trash", ["Trash", "Deleted", "Deleted Items"]);
    if (trash && trash !== mailbox) await moveMessage(s, mailbox, uid, trash);
    else await setFlags(s, mailbox, uid, ["\\Deleted"]);
    return c.json({ ok: true });
  } catch (err) {
    fail(err);
  }
});

app.post(
  "/api/send",
  bodyLimit({ maxSize: 20 * 1024 * 1024, onError: (c) => c.json({ error: "Message too large" }, 413) }),
  async (c) => {
    const s = requireSession(c);
    const body = (await c.req.json()) as SendBody;
    if (!body.to?.length || !body.subject) throw new HTTPException(400, { message: "to and subject required" });
    try {
      return c.json(await sendMail(s, body));
    } catch (err) {
      fail(err);
    }
  },
);

app.get("/api/keys/lookup", async (c) => {
  requireSession(c);
  const email = c.req.query("email");
  if (!email) throw new HTTPException(400, { message: "email required" });
  try {
    const key = await lookupKey(email);
    return c.json({ key });
  } catch (err) {
    fail(err);
  }
});

app.get("/api/calendars", async (c) => {
  const s = requireSession(c);
  try {
    return c.json({ calendars: await listCalendars(s) });
  } catch (err) {
    fail(err);
  }
});

app.get("/api/events", async (c) => {
  const s = requireSession(c);
  const calendar = c.req.query("calendar") || "";
  const from = c.req.query("from") || new Date().toISOString();
  const to = c.req.query("to") || new Date(Date.now() + 31 * 86400000).toISOString();
  try {
    return c.json({ events: await listEvents(s, calendar, from, to) });
  } catch (err) {
    fail(err);
  }
});

app.post("/api/events", async (c) => {
  const s = requireSession(c);
  const body = await c.req.json<{
    calendar: string;
    summary: string;
    description?: string;
    location?: string;
    dtstart: string;
    dtend?: string;
    allDay?: boolean;
  }>();
  try {
    return c.json(await createEvent(s, body.calendar, body));
  } catch (err) {
    fail(err);
  }
});

app.delete("/api/events", async (c) => {
  const s = requireSession(c);
  const url = c.req.query("url") || "";
  if (!url) throw new HTTPException(400, { message: "url required" });
  try {
    await deleteEvent(s, url);
    return c.json({ ok: true });
  } catch (err) {
    fail(err);
  }
});

app.get("/api/contacts", async (c) => {
  const s = requireSession(c);
  try {
    return c.json({ contacts: await listContacts(s) });
  } catch (err) {
    fail(err);
  }
});

app.post("/api/invite/respond", async (c) => {
  const s = requireSession(c);
  const body = await c.req.json<{
    mailbox: string;
    uid: number;
    action: "accept" | "decline" | "tentative";
    calendarUrl?: string;
  }>();
  const partstat = body.action === "accept" ? "ACCEPTED" : body.action === "decline" ? "DECLINED" : "TENTATIVE";
  try {
    const msg = await getMessage(s, body.mailbox, body.uid);
    if (!msg.invite) throw Object.assign(new Error("No invitation on this message"), { status: 400 });
    const [event] = parseCalendar(msg.invite.ics);
    if (!event) throw Object.assign(new Error("Could not parse invitation"), { status: 400 });
    if (body.calendarUrl && partstat !== "DECLINED") {
      await putEvent(s, body.calendarUrl, `${event.uid}.ics`, storeIcs(event, s.email, partstat));
    }
    if (event.organizer?.email) {
      const ics = replyIcs(event, s.email, partstat);
      const verb = partstat === "ACCEPTED" ? "Accepted" : partstat === "DECLINED" ? "Declined" : "Tentative";
      await sendMail(s, {
        to: [event.organizer.email],
        subject: `${verb}: ${event.summary}`,
        text: `${verb} invitation: ${event.summary}`,
        raw: undefined,
        attachments: [
          {
            filename: "invite.ics",
            contentType: `text/calendar; method=REPLY; charset=utf-8`,
            content: Buffer.from(ics).toString("base64"),
          },
        ],
      });
    }
    await setFlags(s, body.mailbox, body.uid, ["\\Answered"]);
    return c.json({ ok: true, partstat });
  } catch (err) {
    fail(err);
  }
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = existsSync(path.join(process.cwd(), "dist/web/index.html"))
  ? "dist/web"
  : path.relative(process.cwd(), path.join(here, "../../dist/web"));

if (existsSync(path.join(process.cwd(), webRoot, "index.html")) || process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("*", serveStatic({ root: webRoot, rewriteRequestPath: () => "/index.html" }));
}

serve({ fetch: app.fetch, port: PORT, hostname: process.env.HATSU_HOST || "0.0.0.0" }, (info) => {
  console.log(`hatsu listening on http://${info.address}:${info.port}`);
});
