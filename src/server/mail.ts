import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import type { ImapFlow } from "imapflow";
import type { AttachmentMeta, InviteHint, Mailbox, MessageSummary, PgpHint } from "./types.ts";
import type { Session } from "./session.ts";
import { withImap } from "./session.ts";
import { parseCalendar } from "./ics.ts";

function addrs(v: AddressObject | AddressObject[] | undefined): { name?: string; address: string }[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v.flatMap((a) => a.value) : v.value;
  return list.filter((a) => a.address).map((a) => ({ name: a.name || undefined, address: a.address! }));
}

function envAddrs(list?: { name?: string; address?: string }[] | null): { name?: string; address: string }[] {
  if (!list) return [];
  return list.filter((a) => a.address).map((a) => ({ name: a.name || undefined, address: a.address! }));
}

function toIso(d?: Date | string | null): string | undefined {
  if (!d) return undefined;
  if (d instanceof Date) return d.toISOString();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? String(d) : parsed.toISOString();
}

function hasAttachment(struct: unknown): boolean {
  if (!struct || typeof struct !== "object") return false;
  const s = struct as { disposition?: string; type?: string; childNodes?: unknown[] };
  if (String(s.disposition || "").toLowerCase() === "attachment") return true;
  if (s.type === "multipart" && s.childNodes) return s.childNodes.some(hasAttachment);
  return false;
}

export async function listMailboxes(s: Session): Promise<Mailbox[]> {
  return withImap(s, async (c) => {
    const list = await c.list({ statusQuery: { messages: true, unseen: true } });
    return list
      .filter((m) => !m.flags.has("\\Noselect") && !m.flags.has("\\NonExistent"))
      .map((m) => ({
        path: m.path,
        name: m.name,
        delimiter: m.delimiter || "/",
        specialUse: m.specialUse || undefined,
        flags: [...m.flags],
        messages: m.status?.messages,
        unseen: m.status?.unseen,
      }));
  });
}

export async function listMessages(
  s: Session,
  mailbox: string,
  opts: { page?: number; limit?: number; q?: string },
): Promise<{ messages: MessageSummary[]; exists: number; unseen?: number; page: number; limit: number }> {
  const limit = Math.min(100, Math.max(10, opts.limit || 40));
  const page = Math.max(1, opts.page || 1);
  return withImap(s, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const box = c.mailbox;
      if (!box) return { messages: [], exists: 0, page, limit };
      const exists = box.exists || 0;
      const unseen = (box as { unseen?: number }).unseen;
      if (exists === 0 && !opts.q) return { messages: [], exists: 0, unseen, page, limit };

      let range: string | number[];
      if (opts.q) {
        const uids = (await c.search({ or: [{ subject: opts.q }, { from: opts.q }, { to: opts.q }] }, { uid: true })) || [];
        const slice = uids.slice(Math.max(0, uids.length - page * limit), uids.length - (page - 1) * limit);
        if (!slice.length) return { messages: [], exists: uids.length, unseen, page, limit };
        range = slice;
      } else {
        const end = exists - (page - 1) * limit;
        const start = Math.max(1, end - limit + 1);
        if (end < 1) return { messages: [], exists, unseen, page, limit };
        range = `${start}:${end}`;
      }

      const fetched = await c.fetchAll(range, {
        uid: true,
        flags: true,
        envelope: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
      }, opts.q ? { uid: true } : undefined);

      const messages: MessageSummary[] = fetched.map((m) => ({
        uid: m.uid,
        seq: m.seq,
        flags: [...(m.flags || [])],
        date: toIso(m.internalDate || m.envelope?.date),
        size: m.size,
        subject: m.envelope?.subject || "(no subject)",
        from: envAddrs(m.envelope?.from),
        to: envAddrs(m.envelope?.to),
        hasAttachment: hasAttachment(m.bodyStructure),
      }));
      messages.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.uid - a.uid);
      return { messages, exists: opts.q ? (await c.search({ or: [{ subject: opts.q }, { from: opts.q }, { to: opts.q }] }, { uid: true }) || []).length : exists, unseen, page, limit };
    } finally {
      lock.release();
    }
  });
}

function extractPgp(parsed: ParsedMail, text: string): PgpHint {
  const hint: PgpHint = { encrypted: false, signed: false };
  const blob = [text, parsed.html || "", ...(parsed.attachments || []).map((a) => (typeof a.content === "string" ? a.content : a.content?.toString("utf8") || ""))].join("\n");
  const msg = blob.match(/-----BEGIN PGP MESSAGE-----[\s\S]+?-----END PGP MESSAGE-----/);
  const signed = blob.match(/-----BEGIN PGP SIGNED MESSAGE-----[\s\S]+?-----END PGP SIGNATURE-----/);
  const ct = String(parsed.headers.get("content-type") || "");
  if (msg) {
    hint.encrypted = true;
    hint.armored = msg[0];
  }
  if (/multipart\/encrypted/i.test(ct) || parsed.attachments?.some((a) => /pgp-encrypted|octet-stream/i.test(a.contentType) && /encrypted/i.test(a.filename || ""))) {
    hint.encrypted = true;
    const att = parsed.attachments?.find((a) => /pgp|encrypted/i.test(a.filename || "") || /pgp/i.test(a.contentType));
    if (att?.content && !hint.armored) {
      const t = typeof att.content === "string" ? att.content : att.content.toString("utf8");
      const m = t.match(/-----BEGIN PGP MESSAGE-----[\s\S]+?-----END PGP MESSAGE-----/);
      hint.armored = m ? m[0] : t;
    }
  }
  if (signed) {
    hint.signed = true;
    hint.cleartext = signed[0];
  }
  if (/multipart\/signed/i.test(ct)) hint.signed = true;
  return hint;
}

function extractInvite(parsed: ParsedMail, text: string): InviteHint | undefined {
  const parts: string[] = [];
  for (const att of parsed.attachments || []) {
    if (/calendar|ics/i.test(att.contentType) || /\.ics$/i.test(att.filename || "")) {
      parts.push(typeof att.content === "string" ? att.content : att.content.toString("utf8"));
    }
  }
  const calHeader = parsed.headers.get("content-type");
  if (typeof parsed.textAsHtml === "string" && /BEGIN:VCALENDAR/.test(text)) parts.push(text);
  if (/text\/calendar/i.test(String(calHeader)) && parsed.text) parts.push(parsed.text);
  for (const ics of parts) {
    const events = parseCalendar(ics);
    const ev = events[0];
    if (!ev) continue;
    return {
      uid: ev.uid,
      summary: ev.summary,
      dtstart: ev.dtstart,
      dtend: ev.dtend,
      allDay: ev.allDay,
      location: ev.location,
      organizer: ev.organizer ? { name: ev.organizer.cn, address: ev.organizer.email } : undefined,
      method: ev.method,
      ics,
    };
  }
  return undefined;
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "style"]),
  allowedAttributes: {
    "*": ["class", "style", "colspan", "rowspan", "align", "valign"],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto", "cid", "data"],
  allowProtocolRelative: false,
};

export async function getMessage(s: Session, mailbox: string, uid: number) {
  return withImap(s, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg = await c.fetchOne(String(uid), { uid: true, flags: true, envelope: true, source: true, size: true, bodyStructure: true, internalDate: true }, { uid: true });
      if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
      if (!msg.source) throw Object.assign(new Error("Message not found"), { status: 404 });
      if ((msg.size || 0) > 25 * 1024 * 1024) {
        throw Object.assign(new Error("Message is larger than 25 MB"), { status: 413 });
      }
      const parsed = await simpleParser(msg.source, { skipImageLinks: true });
      const text = parsed.text || "";
      const html = parsed.html ? sanitizeHtml(parsed.html, SANITIZE) : undefined;
      const attachments: AttachmentMeta[] = (parsed.attachments || [])
        .filter((a) => !a.contentType?.startsWith("text/calendar"))
        .map((a, i) => ({
          filename: a.filename || `attachment-${i + 1}`,
          contentType: a.contentType || "application/octet-stream",
          size: a.size || a.content?.length || 0,
          contentId: a.cid,
        }));
      if (!msg.flags?.has("\\Seen")) {
        try {
          await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        } catch {
          /* some servers deny */
        }
      }
      return {
        uid: msg.uid,
        flags: [...(msg.flags || [])],
        date: toIso(msg.internalDate || parsed.date),
        subject: parsed.subject || msg.envelope?.subject || "(no subject)",
        from: addrs(parsed.from) || envAddrs(msg.envelope?.from),
        to: addrs(parsed.to),
        cc: addrs(parsed.cc),
        replyTo: addrs(parsed.replyTo),
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        references: typeof parsed.references === "string" ? parsed.references : parsed.references?.join(" "),
        text,
        html,
        attachments,
        pgp: extractPgp(parsed, text),
        invite: extractInvite(parsed, text),
      };
    } finally {
      lock.release();
    }
  });
}

export async function downloadAttachment(s: Session, mailbox: string, uid: number, filename: string) {
  return withImap(s, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg) throw Object.assign(new Error("Message not found"), { status: 404 });
      if (!msg.source) throw Object.assign(new Error("Message not found"), { status: 404 });
      const parsed = await simpleParser(msg.source);
      const att = parsed.attachments?.find((a) => a.filename === filename);
      if (!att) throw Object.assign(new Error("Attachment not found"), { status: 404 });
      const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
      return { filename: att.filename || filename, contentType: att.contentType || "application/octet-stream", body: buf };
    } finally {
      lock.release();
    }
  });
}

export async function setFlags(s: Session, mailbox: string, uid: number, add: string[] = [], remove: string[] = []) {
  return withImap(s, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      if (add.length) await c.messageFlagsAdd(String(uid), add, { uid: true });
      if (remove.length) await c.messageFlagsRemove(String(uid), remove, { uid: true });
    } finally {
      lock.release();
    }
  });
}

export async function moveMessage(s: Session, mailbox: string, uid: number, target: string) {
  return withImap(s, async (c) => {
    const lock = await c.getMailboxLock(mailbox);
    try {
      await c.messageMove(String(uid), target, { uid: true });
    } finally {
      lock.release();
    }
  });
}

export function specialFolder(boxes: Mailbox[], use: string, fallback: string[]): string | undefined {
  const byUse = boxes.find((b) => b.specialUse === use);
  if (byUse) return byUse.path;
  const lower = fallback.map((n) => n.toLowerCase());
  return boxes.find((b) => lower.includes(b.name.toLowerCase()) || lower.includes(b.path.toLowerCase()))?.path;
}

export type SendBody = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  raw?: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
};

export async function sendMail(s: Session, body: SendBody): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: s.smtp.host,
    port: s.smtp.port,
    secure: s.smtp.secure || s.smtp.port === 465,
    requireTLS: !s.smtp.secure && s.smtp.port === 587,
    auth: { user: s.email, pass: s.password },
    tls: { rejectUnauthorized: !s.tlsInsecure },
    connectionTimeout: 20_000,
  });

  const from = s.name ? `"${s.name.replace(/"/g, "")}" <${s.email}>` : s.email;
  const envelopeTo = [...body.to, ...(body.cc || []), ...(body.bcc || [])];

  const info = body.raw
    ? await transporter.sendMail({
        envelope: { from: s.email, to: envelopeTo },
        raw: body.raw,
      })
    : await transporter.sendMail({
        from,
        to: body.to.join(", "),
        cc: body.cc?.join(", "),
        bcc: body.bcc?.join(", "),
        subject: body.subject,
        text: body.text,
        html: body.html,
        inReplyTo: body.inReplyTo,
        references: body.references,
        attachments: body.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, "base64"),
          contentType: a.contentType,
        })),
      });

  const raw = body.raw || (await buildRawForSent(from, body, info.messageId || ""));
  try {
    const boxes = await listMailboxes(s);
    const sent = specialFolder(boxes, "\\Sent", ["Sent", "Sent Items", "Sent Mail"]);
    if (sent) {
      await withImap(s, async (c: ImapFlow) => {
        await c.append(sent, raw, ["\\Seen"]);
      });
    }
  } catch {
    /* sending succeeded even if APPEND failed */
  }
  return { messageId: info.messageId || "" };
}

async function buildRawForSent(from: string, body: SendBody, messageId: string): Promise<string> {
  const transporter = nodemailer.createTransport({ streamTransport: true, newline: "unix" });
  const info = await transporter.sendMail({
    from,
    to: body.to.join(", "),
    cc: body.cc?.join(", "),
    subject: body.subject,
    text: body.text,
    html: body.html,
    inReplyTo: body.inReplyTo,
    references: body.references,
    messageId,
    attachments: body.attachments?.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.contentType,
    })),
  });
  const message = info.message;
  if (Buffer.isBuffer(message)) return message.toString("utf8");
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    message.on("data", (c: Buffer) => chunks.push(c));
    message.on("end", () => resolve());
    message.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}
