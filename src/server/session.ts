import { randomBytes } from "node:crypto";
import { ImapFlow } from "imapflow";
import type { createDAVClient } from "tsdav";
import type { ServerCfg, SessionInfo } from "./types.ts";

type Dav = Awaited<ReturnType<typeof createDAVClient>>;

export type Session = {
  id: string;
  email: string;
  name?: string;
  password: string;
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  tlsInsecure: boolean;
  lastUsed: number;
  imapClient?: ImapFlow;
  imapChain: Promise<unknown>;
  calClient?: Dav;
  cardClient?: Dav;
};

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, Session>();

export function createSession(init: Omit<Session, "id" | "lastUsed" | "imapChain">): Session {
  const id = randomBytes(24).toString("base64url");
  const session: Session = { ...init, id, lastUsed: Date.now(), imapChain: Promise.resolve() };
  store.set(id, session);
  return session;
}

export function getSession(id: string | undefined): Session | undefined {
  if (!id) return undefined;
  const s = store.get(id);
  if (!s) return undefined;
  if (Date.now() - s.lastUsed > TTL_MS) {
    void destroySession(id);
    return undefined;
  }
  s.lastUsed = Date.now();
  return s;
}

export async function destroySession(id: string): Promise<void> {
  const s = store.get(id);
  store.delete(id);
  if (s?.imapClient) {
    try {
      await s.imapClient.logout();
    } catch {
      try {
        s.imapClient.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export function publicSession(s: Session): SessionInfo {
  return {
    email: s.email,
    name: s.name,
    imap: s.imap,
    smtp: s.smtp,
    caldav: s.caldav,
    carddav: s.carddav,
    tlsInsecure: s.tlsInsecure,
  };
}

export async function withImap<T>(s: Session, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const client = await ensureImap(s);
    try {
      return await fn(client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/socket|closed|not available|timeout|ECONN/i.test(msg)) {
        s.imapClient = undefined;
        const retry = await ensureImap(s);
        return await fn(retry);
      }
      throw err;
    }
  };
  const next = s.imapChain.then(run, run);
  s.imapChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function ensureImap(s: Session): Promise<ImapFlow> {
  if (s.imapClient && (s.imapClient as ImapFlow & { usable?: boolean }).usable !== false) return s.imapClient;
  const client = new ImapFlow({
    host: s.imap.host,
    port: s.imap.port,
    secure: s.imap.secure,
    auth: { user: s.email, pass: s.password },
    logger: false,
    tls: { rejectUnauthorized: !s.tlsInsecure },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    clientInfo: { name: "Hatsu", vendor: "Hatsu" },
  });
  client.on("error", () => {
    s.imapClient = undefined;
  });
  client.on("close", () => {
    s.imapClient = undefined;
  });
  await client.connect();
  s.imapClient = client;
  return client;
}

export async function verifyImap(cfg: ServerCfg, email: string, password: string, tlsInsecure: boolean): Promise<void> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: email, pass: password },
    logger: false,
    tls: { rejectUnauthorized: !tlsInsecure },
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    verifyOnly: true,
  });
  await client.connect();
  try {
    await client.logout();
  } catch {
    /* ignore */
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.lastUsed > TTL_MS) void destroySession(id);
  }
}, 60_000).unref();
