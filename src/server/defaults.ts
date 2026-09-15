import type { Discovery, ServerCfg } from "./types.ts";

function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function imapSecureForPort(port: number): boolean {
  return port === 993 || port === 3993;
}

export function smtpSecureForPort(port: number): boolean {
  return port === 465 || port === 3465;
}

export type AppDefaults = Discovery & {
  demo: boolean;
  email?: string;
  tlsInsecure: boolean;
};

export function demoEnabled(): boolean {
  return envFlag("HATSU_DEMO") || Boolean(process.env.HATSU_DEFAULT_IMAP_HOST);
}

export function appDefaults(): AppDefaults | null {
  if (!demoEnabled()) return null;
  const imapPort = envNum("HATSU_DEFAULT_IMAP_PORT", 3143);
  const smtpPort = envNum("HATSU_DEFAULT_SMTP_PORT", 3025);
  const imap: ServerCfg = {
    host: process.env.HATSU_DEFAULT_IMAP_HOST || "greenmail",
    port: imapPort,
    secure: envFlag("HATSU_DEFAULT_IMAP_SECURE", imapSecureForPort(imapPort)),
  };
  const smtp: ServerCfg = {
    host: process.env.HATSU_DEFAULT_SMTP_HOST || "greenmail",
    port: smtpPort,
    secure: envFlag("HATSU_DEFAULT_SMTP_SECURE", smtpSecureForPort(smtpPort)),
  };
  return {
    demo: true,
    email: process.env.HATSU_DEFAULT_EMAIL || "demo@example.com",
    imap,
    smtp,
    caldav: process.env.HATSU_DEFAULT_CALDAV || "http://radicale:5232",
    carddav: process.env.HATSU_DEFAULT_CARDDAV || "http://radicale:5232",
    tlsInsecure: envFlag("HATSU_DEFAULT_TLS_INSECURE", true),
    notes: [
      "Demo stack: IMAP/SMTP is GreenMail on the compose network (hostname greenmail). Any email and password are accepted.",
      "Do not type localhost here — Hatsu resolves hosts from inside its container.",
    ],
  };
}

export function resolveHostError(host: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return `Cannot resolve IMAP host "${host}". Hatsu looks up that name from inside its own container, not your browser. Run the full compose file (hatsu + greenmail on the same network) and use host "greenmail" port 3143. If you only started the hatsu image, GreenMail is not running.`;
  }
  if (/ECONNREFUSED/i.test(message)) {
    return `IMAP host "${host}" refused the connection. Is GreenMail up, and is the port 3143 (plain) or 3993 (TLS)?`;
  }
  return message;
}
