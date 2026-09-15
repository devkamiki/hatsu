import { resolveMx, resolveSrv } from "node:dns/promises";
import { appDefaults } from "./defaults.ts";
import type { Discovery, ServerCfg } from "./types.ts";

const FETCH_MS = 4000;
const UA = "Hatsu/0.1 (mail autodiscover)";

function imapSecure(port: number, socket?: string): boolean {
  const s = (socket || "").toLowerCase();
  if (s === "ssl" || s === "on" || s === "true") return true;
  if (s === "plain" || s === "off" || s === "never" || s === "starttls") return port === 993;
  return port === 993;
}

function smtpSecure(port: number, socket?: string): boolean {
  const s = (socket || "").toLowerCase();
  if (port === 465) return true;
  if (s === "ssl" && port !== 587) return true;
  return false;
}

function stripNs(xml: string): string {
  return xml
    .replace(/<\/?[\w.-]+:/g, (m) => (m.startsWith("</") ? "</" : "<"))
    .replace(/\sxmlns(?::\w+)?="[^"]*"/g, "");
}

function tagText(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i"));
  return m?.[1]?.trim();
}

function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi");
  return xml.match(re) || [];
}

function attr(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m?.[1];
}

function davUrl(host: string, port?: number): string {
  const p = port && port !== 443 ? `:${port}` : "";
  return `https://${host}${p}`;
}

export function parseThunderbirdXml(xml: string): Partial<Discovery> | null {
  const raw = stripNs(xml);
  if (!/<clientConfig/i.test(raw) && !/<incomingServer/i.test(raw)) return null;
  const out: Partial<Discovery> = {};
  for (const block of blocks(raw, "incomingServer")) {
    const type = (attr(block, "type") || tagText(block, "type") || "").toLowerCase();
    const host = tagText(block, "hostname");
    const port = Number(tagText(block, "port"));
    const socket = tagText(block, "socketType") || "";
    if (!host || !port) continue;
    if (type === "imap" && !out.imap) {
      out.imap = { host, port, secure: imapSecure(port, socket) };
    } else if (type === "caldav" && !out.caldav) {
      out.caldav = davUrl(host, port);
    } else if (type === "carddav" && !out.carddav) {
      out.carddav = davUrl(host, port);
    }
  }
  for (const block of blocks(raw, "outgoingServer")) {
    const type = (attr(block, "type") || "").toLowerCase();
    if (type && type !== "smtp") continue;
    const host = tagText(block, "hostname");
    const port = Number(tagText(block, "port"));
    const socket = tagText(block, "socketType") || "";
    if (host && port && !out.smtp) out.smtp = { host, port, secure: smtpSecure(port, socket) };
  }
  const calPage = tagText(raw, "calendarHomePage") || tagText(raw, "calendarHomeURL");
  if (calPage && !out.caldav) out.caldav = calPage;
  for (const en of blocks(raw, "enable")) {
    const type = (attr(en, "type") || "").toLowerCase();
    const url = attr(en, "url");
    if (!url) continue;
    if (/calendar|caldav/i.test(type) && !out.caldav) out.caldav = url;
    if (/carddav|contacts/i.test(type) && !out.carddav) out.carddav = url;
  }
  return out.imap || out.smtp || out.caldav || out.carddav ? out : null;
}

export function parseOutlookXml(xml: string): { discovery: Partial<Discovery>; redirectAddr?: string; redirectUrl?: string } | null {
  const raw = stripNs(xml);
  if (!/<Autodiscover/i.test(raw) && !/<Protocol/i.test(raw)) return null;
  const redirectAddr = tagText(raw, "RedirectAddr");
  const redirectUrl = tagText(raw, "RedirectUrl");
  const out: Partial<Discovery> = {};
  for (const block of blocks(raw, "Protocol")) {
    const type = (tagText(block, "Type") || "").toUpperCase();
    const host = tagText(block, "Server");
    const port = Number(tagText(block, "Port"));
    const ssl = tagText(block, "SSL") || tagText(block, "Encryption") || "";
    if (!host) continue;
    if (type === "IMAP" && port && !out.imap) {
      out.imap = { host, port, secure: imapSecure(port, ssl) };
    } else if (type === "SMTP" && port && !out.smtp) {
      out.smtp = { host, port, secure: smtpSecure(port, ssl) };
    } else if ((type === "CALDAV" || /caldav/i.test(host)) && !out.caldav) {
      out.caldav = host.includes("://") ? host : davUrl(host, port);
    } else if ((type === "CARDDAV" || /carddav/i.test(host)) && !out.carddav) {
      out.carddav = host.includes("://") ? host : davUrl(host, port);
    }
  }
  if (out.imap || out.smtp || redirectAddr || redirectUrl) return { discovery: out, redirectAddr, redirectUrl };
  return null;
}

export function commonNames(domain: string): Discovery {
  return {
    imap: { host: `imap.${domain}`, port: 993, secure: true },
    smtp: { host: `smtp.${domain}`, port: 587, secure: false },
    notes: [`Guessed imap.${domain}:993 and smtp.${domain}:587`],
  };
}

export function mxIspCandidates(mxHost: string, emailDomain: string): string[] {
  const host = mxHost.replace(/\.$/, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join(".");
    if (d !== emailDomain && !out.includes(d)) out.push(d);
  }
  return out;
}

async function srv(name: string): Promise<{ host: string; port: number } | null> {
  try {
    const recs = await resolveSrv(name);
    recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    const r = recs[0];
    if (!r) return null;
    return { host: r.name.replace(/\.$/, ""), port: r.port };
  } catch {
    return null;
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
      headers: {
        accept: "application/xml, text/xml, */*",
        "user-agent": UA,
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function wellKnown(domain: string, kind: "caldav" | "carddav"): Promise<string | undefined> {
  const urls = [`https://${domain}/.well-known/${kind}`, `https://dav.${domain}/.well-known/${kind}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_MS),
        headers: { "user-agent": UA },
      });
      if (res.ok || res.status === 401 || res.status === 403) {
        const final = res.url.replace(/\/\.well-known\/[^/]+\/?$/, "");
        return final || url;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function mergeInto(target: Discovery, partial: Partial<Discovery>, note?: string) {
  if (partial.imap && !target.imap.host) target.imap = partial.imap;
  if (partial.smtp && !target.smtp.host) target.smtp = partial.smtp;
  if (partial.caldav && !target.caldav) target.caldav = partial.caldav;
  if (partial.carddav && !target.carddav) target.carddav = partial.carddav;
  if (note) target.notes.push(note);
}

function emptyDiscovery(): Discovery {
  return {
    imap: { host: "", port: 993, secure: true },
    smtp: { host: "", port: 587, secure: false },
    notes: [],
  };
}

function mailComplete(d: Discovery): boolean {
  return Boolean(d.imap.host && d.smtp.host);
}

async function fromThunderbirdHost(domain: string, email: string): Promise<Partial<Discovery> | null> {
  const urls = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://www.${domain}/mozilla.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
  ];
  for (const url of urls) {
    const xml = await fetchText(url);
    if (!xml) continue;
    const parsed = parseThunderbirdXml(xml);
    if (parsed?.imap || parsed?.smtp) return parsed;
  }
  return null;
}

const OUTLOOK_BODY = (email: string) => `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">
  <Request>
    <EMailAddress>${email}</EMailAddress>
    <AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema>
  </Request>
</Autodiscover>`;

async function fetchOutlook(url: string, email: string, depth = 0): Promise<Partial<Discovery> | null> {
  if (depth > 2) return null;
  let xml = await fetchText(url);
  if (!xml) {
    xml = await fetchText(url, {
      method: "POST",
      headers: { "content-type": "text/xml; charset=utf-8" },
      body: OUTLOOK_BODY(email),
    });
  }
  if (!xml) return null;
  const parsed = parseOutlookXml(xml);
  if (!parsed) return null;
  if (parsed.redirectUrl) return fetchOutlook(parsed.redirectUrl, email, depth + 1);
  if (parsed.redirectAddr && parsed.redirectAddr.includes("@")) {
    const domain = parsed.redirectAddr.split("@")[1];
    return fetchOutlook(`https://autodiscover.${domain}/autodiscover/autodiscover.xml`, parsed.redirectAddr, depth + 1);
  }
  return parsed.discovery.imap || parsed.discovery.smtp ? parsed.discovery : null;
}

async function fromOutlook(domain: string, email: string): Promise<Partial<Discovery> | null> {
  const rec = await srv(`_autodiscover._tcp.${domain}`);
  const urls: string[] = [];
  if (rec) {
    const port = rec.port && rec.port !== 443 ? `:${rec.port}` : "";
    urls.push(`https://${rec.host}${port}/autodiscover/autodiscover.xml`);
  }
  urls.push(
    `https://autodiscover.${domain}/autodiscover/autodiscover.xml`,
    `https://${domain}/autodiscover/autodiscover.xml`,
  );
  for (const url of urls) {
    const found = await fetchOutlook(url, email);
    if (found) return found;
  }
  return null;
}

async function ispdb(domain: string): Promise<Partial<Discovery> | null> {
  const xml = await fetchText(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`);
  if (!xml) return null;
  return parseThunderbirdXml(xml);
}

async function fromMx(domain: string): Promise<Partial<Discovery> | null> {
  const tried = new Set<string>();
  const tryDomain = async (d: string) => {
    if (tried.has(d)) return null;
    tried.add(d);
    return ispdb(d);
  };
  const direct = await tryDomain(domain);
  if (direct?.imap && direct.smtp) return direct;
  let mx: { exchange: string; priority: number }[] = [];
  try {
    mx = await resolveMx(domain);
    mx.sort((a, b) => a.priority - b.priority);
  } catch {
    return direct;
  }
  for (const rec of mx) {
    for (const cand of mxIspCandidates(rec.exchange, domain)) {
      const found = await tryDomain(cand);
      if (found?.imap && found.smtp) return found;
    }
  }
  return direct;
}

async function fromSrv(domain: string): Promise<Partial<Discovery>> {
  const [imaps, imap, submissions, submission, caldavs, carddavs] = await Promise.all([
    srv(`_imaps._tcp.${domain}`),
    srv(`_imap._tcp.${domain}`),
    srv(`_submissions._tcp.${domain}`),
    srv(`_submission._tcp.${domain}`),
    srv(`_caldavs._tcp.${domain}`),
    srv(`_carddavs._tcp.${domain}`),
  ]);
  const out: Partial<Discovery> = {};
  if (imaps) out.imap = { host: imaps.host, port: imaps.port, secure: true };
  else if (imap) out.imap = { host: imap.host, port: imap.port, secure: imap.port === 993 };
  if (submissions) out.smtp = { host: submissions.host, port: submissions.port, secure: submissions.port === 465 };
  else if (submission) out.smtp = { host: submission.host, port: submission.port, secure: submission.port === 465 };
  if (caldavs) out.caldav = davUrl(caldavs.host, caldavs.port);
  if (carddavs) out.carddav = davUrl(carddavs.host, carddavs.port);
  return out;
}

export async function discover(email: string): Promise<Discovery> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) throw new Error("Invalid email");
  const demo = appDefaults();
  if (demo && ["example.com", "greenmail", "localhost", "localtest.me"].includes(domain)) {
    return {
      imap: demo.imap,
      smtp: demo.smtp,
      caldav: demo.caldav,
      carddav: demo.carddav,
      notes: demo.notes,
    };
  }

  const found = emptyDiscovery();

  const srvFound = await fromSrv(domain);
  mergeInto(found, srvFound, srvFound.imap || srvFound.smtp ? "From SRV records" : undefined);

  if (!mailComplete(found)) {
    const tb = await fromThunderbirdHost(domain, email);
    if (tb) mergeInto(found, tb, "From Thunderbird autoconfig");
  }

  if (!mailComplete(found)) {
    const ol = await fromOutlook(domain, email);
    if (ol) mergeInto(found, ol, "From Outlook autodiscover");
  }

  if (!mailComplete(found)) {
    const mx = await fromMx(domain);
    if (mx) mergeInto(found, mx, "From Thunderbird ISPDB (MX)");
  }

  if (!mailComplete(found)) {
    if (domain === "proton.me" || domain === "protonmail.com") {
      mergeInto(
        found,
        {
          imap: { host: "127.0.0.1", port: 1143, secure: false },
          smtp: { host: "127.0.0.1", port: 1025, secure: false },
        },
        "Proton Mail needs Proton Bridge on the host. Point IMAP/SMTP at the bridge.",
      );
    } else {
      const guess = commonNames(domain);
      if (!found.imap.host) found.imap = guess.imap;
      if (!found.smtp.host) found.smtp = guess.smtp;
      found.notes.push(...guess.notes);
    }
  }

  if (!found.caldav) found.caldav = await wellKnown(domain, "caldav");
  if (!found.carddav) found.carddav = await wellKnown(domain, "carddav");

  return found;
}

export function mergeServer(partial: Partial<ServerCfg> | undefined, fallback: ServerCfg): ServerCfg {
  return {
    host: partial?.host || fallback.host,
    port: Number(partial?.port || fallback.port),
    secure: partial?.secure ?? fallback.secure,
  };
}
