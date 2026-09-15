import * as openpgp from "openpgp";
import { api } from "./api";

export type StoredKey = {
  fingerprint: string;
  name: string;
  emails: string[];
  publicArmored: string;
  privateArmored?: string;
  created: number;
  source: "generated" | "imported" | "wkd" | "hkp" | "contact";
};

const DB = "hatsu-pgp";
const STORE = "keys";
let unlocked: { fingerprint: string; key: openpgp.PrivateKey } | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "fingerprint" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listKeys(): Promise<StoredKey[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredKey[]);
    req.onerror = () => reject(req.error);
  });
}

export async function saveKey(key: StoredKey): Promise<void> {
  await tx("readwrite", (s) => s.put(key));
}

export async function deleteKey(fingerprint: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(fingerprint));
  if (unlocked?.fingerprint === fingerprint) unlocked = null;
}

export function getUnlocked(): { fingerprint: string; key: openpgp.PrivateKey } | null {
  return unlocked;
}

export function lockPrivate(): void {
  unlocked = null;
}

export async function unlockPrivate(fingerprint: string, passphrase: string): Promise<void> {
  const key = (await tx("readonly", (s) => s.get(fingerprint))) as StoredKey | undefined;
  if (!key?.privateArmored) throw new Error("No private key for that fingerprint");
  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: key.privateArmored }),
    passphrase,
  });
  unlocked = { fingerprint, key: privateKey };
  localStorage.setItem("hatsu-default-key", fingerprint);
}

export function defaultFingerprint(): string | null {
  return localStorage.getItem("hatsu-default-key");
}

export function setDefaultFingerprint(fp: string): void {
  localStorage.setItem("hatsu-default-key", fp);
}

async function keyMeta(armored: string, source: StoredKey["source"], privateArmored?: string): Promise<StoredKey> {
  const key = await openpgp.readKey({ armoredKey: armored });
  const user = key.users[0]?.userID;
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    name: user?.name || user?.userID || "OpenPGP key",
    emails: key.getUserIDs().map((id) => {
      const m = id.match(/<([^>]+)>/);
      return (m ? m[1] : id).toLowerCase();
    }),
    publicArmored: key.toPublic().armor(),
    privateArmored,
    created: Date.now(),
    source,
  };
}

export async function generateKey(name: string, email: string, passphrase: string): Promise<StoredKey> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name, email }],
    passphrase,
    format: "armored",
  });
  const stored = await keyMeta(publicKey, "generated", privateKey);
  await saveKey(stored);
  setDefaultFingerprint(stored.fingerprint);
  return stored;
}

export async function importArmored(armored: string, source: StoredKey["source"] = "imported"): Promise<StoredKey> {
  const text = armored.trim();
  const isPrivate = text.includes("BEGIN PGP PRIVATE KEY");
  const stored = isPrivate
    ? await keyMeta((await openpgp.readPrivateKey({ armoredKey: text })).toPublic().armor(), source, text)
    : await keyMeta(text, source);
  await saveKey(stored);
  return stored;
}

export async function findLocalByEmail(email: string): Promise<StoredKey | undefined> {
  const keys = await listKeys();
  const e = email.toLowerCase();
  return keys.find((k) => k.emails.includes(e));
}

export async function discoverPublic(email: string): Promise<StoredKey | null> {
  const local = await findLocalByEmail(email);
  if (local) return local;
  const { key } = await api.lookupKey(email);
  if (!key) return null;
  const stored = await importArmored(key.armored, key.source);
  return stored;
}

function rfc2047(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function headerAddr(email: string, name?: string): string {
  return name ? `${rfc2047(name)} <${email}>` : email;
}

export async function encryptAndWrap(opts: {
  text: string;
  from: { email: string; name?: string };
  to: string[];
  cc?: string[];
  subject: string;
  sign: boolean;
  encrypt: boolean;
  inReplyTo?: string;
  references?: string;
}): Promise<{ raw: string } | { text: string }> {
  if (!opts.encrypt && !opts.sign) return { text: opts.text };

  let body = opts.text;
  if (opts.sign && !opts.encrypt) {
    if (!unlocked) throw new Error("Unlock your private key to sign");
    body = await openpgp.sign({
      message: await openpgp.createCleartextMessage({ text: opts.text }),
      signingKeys: unlocked.key,
    });
    return { text: body };
  }

  if (opts.encrypt) {
    const pubKeys: openpgp.PublicKey[] = [];
    const missing: string[] = [];
    for (const email of [...opts.to, ...(opts.cc || []), opts.from.email]) {
      const found = await discoverPublic(email);
      if (!found) missing.push(email);
      else pubKeys.push(await openpgp.readKey({ armoredKey: found.publicArmored }));
    }
    if (missing.length) throw new Error(`No OpenPGP key for: ${missing.join(", ")}`);
    if (opts.sign && !unlocked) throw new Error("Unlock your private key to sign");
    const inner = [`Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: 8bit`, ``, opts.text].join("\r\n");
    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: inner }),
      encryptionKeys: pubKeys,
      signingKeys: opts.sign && unlocked ? unlocked.key : undefined,
    });
    const boundary = `hatsu${crypto.randomUUID().replace(/-/g, "")}`;
    const mime = [
      `From: ${headerAddr(opts.from.email, opts.from.name)}`,
      `To: ${opts.to.join(", ")}`,
      opts.cc?.length ? `Cc: ${opts.cc.join(", ")}` : "",
      `Subject: ${rfc2047(opts.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : "",
      opts.references ? `References: ${opts.references}` : "",
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: application/pgp-encrypted`,
      ``,
      `Version: 1`,
      ``,
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="encrypted.asc"`,
      `Content-Disposition: inline; filename="encrypted.asc"`,
      ``,
      encrypted,
      `--${boundary}--`,
      ``,
    ]
      .filter((l) => l !== "")
      .join("\r\n");
    return { raw: mime };
  }
  return { text: opts.text };
}

export type CryptoResult = {
  text: string;
  encrypted: boolean;
  signed: boolean;
  valid?: boolean;
  signedBy?: string;
  error?: string;
};

export async function decryptOrVerify(pgp: {
  encrypted: boolean;
  signed: boolean;
  armored?: string;
  cleartext?: string;
}): Promise<CryptoResult | null> {
  if (!pgp.encrypted && !pgp.signed) return null;
  try {
    if (pgp.encrypted && pgp.armored) {
      if (!unlocked) return { text: "", encrypted: true, signed: pgp.signed, error: "Unlock your private key to decrypt" };
      const keys = await listKeys();
      const verificationKeys = await Promise.all(keys.map((k) => openpgp.readKey({ armoredKey: k.publicArmored })));
      const { data, signatures } = await openpgp.decrypt({
        message: await openpgp.readMessage({ armoredMessage: pgp.armored }),
        decryptionKeys: unlocked.key,
        verificationKeys,
      });
      let valid: boolean | undefined;
      let signedBy: string | undefined;
      if (signatures.length) {
        try {
          await signatures[0].verified;
          valid = true;
          signedBy = signatures[0].keyID.toHex().toUpperCase();
        } catch {
          valid = false;
        }
      }
      let text = typeof data === "string" ? data : new TextDecoder().decode(data);
      if (/Content-Type:/i.test(text)) {
        const idx = text.search(/\r?\n\r?\n/);
        if (idx >= 0) text = text.slice(idx).trim();
      }
      return { text, encrypted: true, signed: signatures.length > 0, valid, signedBy };
    }
    if (pgp.cleartext) {
      const keys = await listKeys();
      const verificationKeys = await Promise.all(keys.map((k) => openpgp.readKey({ armoredKey: k.publicArmored })));
      const { data, signatures } = await openpgp.verify({
        message: await openpgp.readCleartextMessage({ cleartextMessage: pgp.cleartext }),
        verificationKeys,
      });
      let valid = false;
      let signedBy: string | undefined;
      if (signatures[0]) {
        try {
          await signatures[0].verified;
          valid = true;
          signedBy = signatures[0].keyID.toHex().toUpperCase();
        } catch {
          valid = false;
        }
      }
      return { text: data, encrypted: false, signed: true, valid, signedBy };
    }
  } catch (err) {
    return { text: "", encrypted: pgp.encrypted, signed: pgp.signed, error: err instanceof Error ? err.message : String(err) };
  }
  return { text: "", encrypted: pgp.encrypted, signed: pgp.signed, error: "Could not process OpenPGP data" };
}
