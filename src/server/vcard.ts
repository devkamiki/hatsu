export type Contact = {
  uid: string;
  url?: string;
  fn: string;
  emails: string[];
  keys: { type?: string; value: string }[];
};

export function parseVCard(raw: string, url?: string): Contact {
  const text = raw.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").replace(/\r\n/g, "\n");
  let fn = "";
  let uid = "";
  const emails: string[] = [];
  const keys: { type?: string; value: string }[] = [];
  for (const line of text.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = left.split(";")[0].toUpperCase();
    const params = Object.fromEntries(
      left
        .split(";")
        .slice(1)
        .map((p) => {
          const eq = p.indexOf("=");
          return eq < 0 ? [p.toUpperCase(), ""] : [p.slice(0, eq).toUpperCase(), p.slice(eq + 1)];
        }),
    );
    if (name === "FN") fn = value;
    else if (name === "UID") uid = value;
    else if (name === "EMAIL") emails.push(value.trim());
    else if (name === "KEY") {
      keys.push({ type: params.TYPE || params.PGP || undefined, value: decodeKey(value) });
    }
  }
  return { uid: uid || url || fn || emails[0] || "unknown", url, fn: fn || emails[0] || "Unnamed", emails, keys };
}

function decodeKey(value: string): string {
  const v = value.trim();
  if (v.startsWith("data:")) {
    const comma = v.indexOf(",");
    const meta = v.slice(5, comma);
    const data = v.slice(comma + 1);
    if (/base64/i.test(meta)) {
      const decoded = Buffer.from(data, "base64").toString("utf8");
      return decoded.includes("BEGIN PGP") ? decoded : data;
    }
    return decodeURIComponent(data);
  }
  return v.replace(/\\n/g, "\n");
}
