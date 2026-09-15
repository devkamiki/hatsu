import { resolveSrv } from "node:dns/promises";
import { appDefaults } from "./defaults.ts";
import type { Discovery, ServerCfg } from "./types.ts";

type Hint = {
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  note?: string;
};

const HINTS: Record<string, Hint> = {
  "gmail.com": {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
    note: "Gmail needs IMAP enabled and an app password if 2FA is on.",
  },
  "googlemail.com": {
    imap: { host: "imap.gmail.com", port: 993, secure: true },
    smtp: { host: "smtp.gmail.com", port: 587, secure: false },
  },
  "migadu.com": {
    imap: { host: "imap.migadu.com", port: 993, secure: true },
    smtp: { host: "smtp.migadu.com", port: 465, secure: true },
    caldav: "https://cdav.migadu.com",
    carddav: "https://cdav.migadu.com",
  },
  "fastmail.com": {
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
    caldav: "https://caldav.fastmail.com",
    carddav: "https://carddav.fastmail.com",
  },
  "icloud.com": {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    caldav: "https://caldav.icloud.com",
    carddav: "https://contacts.icloud.com",
    note: "iCloud requires an app-specific password.",
  },
  "me.com": {
    imap: { host: "imap.mail.me.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.me.com", port: 587, secure: false },
    caldav: "https://caldav.icloud.com",
    carddav: "https://contacts.icloud.com",
  },
  "outlook.com": {
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  },
  "hotmail.com": {
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
  },
  "yahoo.com": {
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
  },
  "proton.me": {
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
    note: "Proton Mail needs Proton Bridge on the host. Point IMAP/SMTP at the bridge.",
  },
  "protonmail.com": {
    imap: { host: "127.0.0.1", port: 1143, secure: false },
    smtp: { host: "127.0.0.1", port: 1025, secure: false },
    note: "Proton Mail needs Proton Bridge on the host.",
  },
};

async function srv(name: string): Promise<{ host: string; port: number } | null> {
  try {
    const recs = await resolveSrv(name);
    recs.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    const r = recs[0];
    return { host: r.name.replace(/\.$/, ""), port: r.port };
  } catch {
    return null;
  }
}

async function wellKnown(domain: string, kind: "caldav" | "carddav"): Promise<string | undefined> {
  const urls = [`https://${domain}/.well-known/${kind}`, `https://dav.${domain}/.well-known/${kind}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(4000) });
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
  const notes: string[] = [];
  const hint = HINTS[domain];

  const imaps = await srv(`_imaps._tcp.${domain}`);
  const imap = await srv(`_imap._tcp.${domain}`);
  const submissions = await srv(`_submissions._tcp.${domain}`);
  const submission = await srv(`_submission._tcp.${domain}`);
  const caldavs = await srv(`_caldavs._tcp.${domain}`);
  const carddavs = await srv(`_carddavs._tcp.${domain}`);

  const found: Discovery = {
    imap: hint?.imap ||
      (imaps ? { host: imaps.host, port: imaps.port, secure: true } : imap ? { host: imap.host, port: imap.port, secure: imap.port === 993 } : { host: `imap.${domain}`, port: 993, secure: true }),
    smtp: hint?.smtp ||
      (submissions
        ? { host: submissions.host, port: submissions.port, secure: submissions.port === 465 }
        : submission
          ? { host: submission.host, port: submission.port, secure: submission.port === 465 }
          : { host: `smtp.${domain}`, port: 587, secure: false }),
    caldav: hint?.caldav,
    carddav: hint?.carddav,
    notes,
  };

  if (hint?.note) notes.push(hint.note);

  if (!found.caldav) {
    if (caldavs) found.caldav = `https://${caldavs.host}:${caldavs.port === 443 ? "" : caldavs.port}`.replace(/:$/, "");
    else found.caldav = await wellKnown(domain, "caldav");
  }
  if (!found.carddav) {
    if (carddavs) found.carddav = `https://${carddavs.host}`;
    else found.carddav = await wellKnown(domain, "carddav");
  }

  return found;
}

export function mergeServer(partial: Partial<ServerCfg> | undefined, fallback: ServerCfg): ServerCfg {
  return {
    host: partial?.host || fallback.host,
    port: Number(partial?.port || fallback.port),
    secure: partial?.secure ?? fallback.secure,
  };
}
