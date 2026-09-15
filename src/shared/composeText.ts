export type Addr = { name?: string; address: string };

export type QuoteMessage = {
  from: Addr[];
  to: Addr[];
  cc?: Addr[];
  date?: string;
  subject: string;
  text: string;
  html?: string;
};

export type QuoteStyle = "outlook" | "icloud";
export type ReplyPosition = "above" | "below";
export type WrapMode = "none" | "wrap" | "flowed";

function fmtAddr(a: Addr): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

function fmtList(list?: Addr[]): string {
  return (list || []).map(fmtAddr).join("; ");
}

export function formatWhen(iso: string | undefined, utc: boolean, style: QuoteStyle): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const loc = utc ? "en-US" : undefined;
  const opts: Intl.DateTimeFormatOptions = utc
    ? { timeZone: "UTC", weekday: style === "outlook" ? "long" : "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
    : { weekday: style === "outlook" ? "long" : "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" };
  const formatted = d.toLocaleString(loc || undefined, opts);
  if (style === "icloud") {
    // "Mon, Jan 15, 2024, 10:00 AM" -> "Jan 15, 2024, at 10:00 AM"
    const parts = new Intl.DateTimeFormat(loc || undefined, {
      timeZone: utc ? "UTC" : undefined,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    const time = `${get("hour")}:${get("minute")} ${get("dayPeriod")}`.trim();
    return `${get("month")} ${get("day")}, ${get("year")}, at ${time}${utc ? " UTC" : ""}`;
  }
  return utc ? `${formatted} UTC` : formatted;
}

function quoteLines(text: string): string {
  const body = text.replace(/\s+$/, "");
  if (!body) return ">";
  return body
    .split(/\r?\n/)
    .map((l) => (l.startsWith(">") ? `>${l}` : `> ${l}`))
    .join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function attribution(msg: QuoteMessage, style: QuoteStyle, utc: boolean): { header: string; bodyPrefixed: boolean } {
  const who = msg.from[0] ? fmtAddr(msg.from[0]) : "someone";
  const when = formatWhen(msg.date, utc, style);
  if (style === "outlook") {
    const lines = [
      "-----Original Message-----",
      `From: ${who}`,
      when ? `Sent: ${when}` : "",
      msg.to.length ? `To: ${fmtList(msg.to)}` : "",
      msg.cc?.length ? `Cc: ${fmtList(msg.cc)}` : "",
      `Subject: ${msg.subject}`,
    ].filter((l) => l !== "");
    return { header: lines.join("\n"), bodyPrefixed: false };
  }
  return { header: `On ${when || "an earlier date"}, ${who} wrote:`, bodyPrefixed: true };
}

export function quotePlain(msg: QuoteMessage, style: QuoteStyle, utc: boolean): string {
  const { header, bodyPrefixed } = attribution(msg, style, utc);
  const body = bodyPrefixed ? quoteLines(msg.text || "") : msg.text || "";
  return `${header}\n\n${body}`.replace(/\n+$/, "");
}

export function quoteHtml(msg: QuoteMessage, style: QuoteStyle, utc: boolean): string {
  const { header, bodyPrefixed } = attribution(msg, style, utc);
  const inner = msg.html || `<pre>${escapeHtml(msg.text || "")}</pre>`;
  const head = escapeHtml(header).replace(/\n/g, "<br>");
  const quoted = bodyPrefixed ? `<blockquote>${inner}</blockquote>` : inner;
  return `<div>${head}</div>${quoted}`;
}

export function assembleBody(draft: string, quote: string, position: ReplyPosition, html: boolean): string {
  const q = quote.trim();
  const d = draft;
  if (!q) return d;
  if (html) {
    return position === "below" ? `${q}<br><br>${d}` : `${d}<br><br>${q}`;
  }
  return position === "below" ? `${q}\n\n${d}` : `${d}\n\n${q}`;
}

export function forwardSubject(subject: string): string {
  return /^(fw|fwd)\s*:/i.test(subject) ? subject : `Fw: ${subject}`;
}

function spaceStuff(line: string): string {
  if (line.startsWith(" ") || line.startsWith("From ")) return ` ${line}`;
  return line;
}

function wrapLine(line: string, width: number, flowed: boolean): string[] {
  if (line.length <= width) return [flowed ? spaceStuff(line) : line];
  const quote = line.match(/^(>+ ?)/);
  const prefix = quote ? quote[1] : "";
  const body = quote ? line.slice(prefix.length) : line;
  const room = Math.max(20, width - prefix.length);
  const out: string[] = [];
  let rest = body;
  while (rest.length > room) {
    let at = rest.lastIndexOf(" ", room);
    if (at < room / 2) at = room;
    let chunk = rest.slice(0, at).trimEnd();
    rest = rest.slice(at).trimStart();
    if (flowed && !chunk.endsWith(" ")) chunk += " ";
    out.push(flowed ? spaceStuff(prefix + chunk) : prefix + chunk);
  }
  out.push(flowed ? spaceStuff(prefix + rest) : prefix + rest);
  return out;
}

export function wrapText(text: string, mode: WrapMode, width = 78): string {
  if (mode === "none") return text;
  const flowed = mode === "flowed";
  return text
    .split(/\r?\n/)
    .flatMap((line) => wrapLine(line, width, flowed))
    .join("\n");
}

export function rfc2822Utc(d = new Date()): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}
