import { createHash } from "node:crypto";
import * as openpgp from "openpgp";

const ZBASE32 = "ybndrfg8ejkmcpqxot1uwisza345h769";

export function zbase32Encode(data: Uint8Array): string {
  let value = 0n;
  let bits = 0n;
  let output = "";
  for (const byte of data) {
    value = (value << 8n) | BigInt(byte);
    bits += 8n;
    while (bits >= 5n) {
      output += ZBASE32[Number((value >> (bits - 5n)) & 31n)];
      bits -= 5n;
      value &= (1n << bits) - 1n;
    }
  }
  if (bits > 0n) output += ZBASE32[Number((value << (5n - bits)) & 31n)];
  return output;
}

export function wkdHash(localPart: string): string {
  const normalized = localPart.toLowerCase().normalize("NFC");
  const sha1 = createHash("sha1").update(normalized, "utf8").digest();
  return zbase32Encode(sha1);
}

export type LookedUpKey = {
  armored: string;
  fingerprint: string;
  userIDs: string[];
  source: "wkd" | "hkp";
};

async function parseArmored(armored: string, source: "wkd" | "hkp"): Promise<LookedUpKey | null> {
  const text = armored.trim();
  if (!text.includes("BEGIN PGP PUBLIC KEY")) return null;
  try {
    const key = await openpgp.readKey({ armoredKey: text });
    return {
      armored: key.armor(),
      fingerprint: key.getFingerprint().toUpperCase(),
      userIDs: key.getUserIDs(),
      source,
    };
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<{ ok: boolean; body: string; status: number }> {
  const res = await fetch(url, {
    headers: { Accept: "application/octet-stream, application/pgp-keys, text/plain, */*" },
    signal: AbortSignal.timeout(8000),
    redirect: "follow",
  });
  const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
  return { ok: res.ok, body, status: res.status };
}

export async function lookupWkd(email: string): Promise<LookedUpKey | null> {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  const hu = wkdHash(local);
  const l = encodeURIComponent(local.toLowerCase());
  const urls = [
    `https://openpgpkey.${domain}/.well-known/openpgpkey/${domain}/hu/${hu}?l=${l}`,
    `https://${domain}/.well-known/openpgpkey/hu/${hu}?l=${l}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const asText = buf.toString("utf8");
      const armored = asText.includes("BEGIN PGP") ? asText : (await openpgp.readKey({ binaryKey: buf })).armor();
      const parsed = await parseArmored(armored, "wkd");
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export async function lookupHkp(email: string, base = process.env.HATSU_HKP || "https://keys.openpgp.org"): Promise<LookedUpKey | null> {
  const origin = base.replace(/\/$/, "");
  const urls = [
    `${origin}/vks/v1/by-email/${encodeURIComponent(email)}`,
    `${origin}/pks/lookup?op=get&options=mr&search=${encodeURIComponent(email)}`,
  ];
  for (const url of urls) {
    try {
      const { ok, body } = await fetchText(url);
      if (!ok) continue;
      const parsed = await parseArmored(body, "hkp");
      if (parsed) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

export async function lookupKey(email: string): Promise<LookedUpKey | null> {
  return (await lookupWkd(email)) || (await lookupHkp(email));
}
