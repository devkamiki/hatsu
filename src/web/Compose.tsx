import { useEffect, useRef, useState } from "react";
import { api, type Message, type SessionInfo } from "./api";
import { encryptAndWrap, getUnlocked } from "./pgp";
import { loadComposePrefs } from "./prefs";
import { assembleBody, forwardSubject, quoteHtml, quotePlain, wrapText } from "../shared/composeText";

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/blockquote>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function Compose({
  session,
  replyTo,
  forward = false,
  onClose,
  onSent,
}: {
  session: SessionInfo;
  replyTo?: Message;
  forward?: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const prefs = loadComposePrefs();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"plain" | "html">(prefs.format);
  const [encrypt, setEncrypt] = useState(false);
  const [sign, setSign] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState("");
  const htmlRef = useRef<HTMLDivElement>(null);
  const primed = useRef(false);

  useEffect(() => {
    if (!replyTo || primed.current) return;
    primed.current = true;
    const dest = (replyTo.replyTo.length ? replyTo.replyTo : replyTo.from).map((a) => a.address).join(", ");
    if (forward) {
      setTo("");
      setSubject(forwardSubject(replyTo.subject));
    } else {
      setTo(dest);
      setSubject(replyTo.subject.toLowerCase().startsWith("re:") ? replyTo.subject : `Re: ${replyTo.subject}`);
    }
    const quote =
      format === "html"
        ? quoteHtml(replyTo, prefs.quoteStyle, prefs.dateUtc)
        : quotePlain(replyTo, prefs.quoteStyle, prefs.dateUtc);
    const body = assembleBody("", quote, prefs.replyPosition, format === "html");
    setText(format === "html" ? htmlToText(body) : body);
    if (format === "html" && htmlRef.current) htmlRef.current.innerHTML = body;
  }, [replyTo, forward, format, prefs.quoteStyle, prefs.replyPosition, prefs.dateUtc]);

  async function onToBlur() {
    const emails = to.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.includes("@"));
    const found: string[] = [];
    const missing: string[] = [];
    for (const e of emails) {
      try {
        const { key } = await api.lookupKey(e);
        if (key) found.push(e);
        else missing.push(e);
      } catch {
        missing.push(e);
      }
    }
    if (found.length && !missing.length) {
      setEncrypt(true);
      setLookup(`OpenPGP keys found for ${found.join(", ")}`);
    } else if (found.length) {
      setLookup(`Keys for ${found.join(", ")}; missing ${missing.join(", ")}`);
    } else if (emails.length) setLookup("No public keys found (WKD/HKP)");
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const toList = to.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      const ccList = cc.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
      const html = format === "html" && !encrypt ? htmlRef.current?.innerHTML || "" : undefined;
      const plain = html ? htmlToText(html) : text;
      const wrapped = wrapText(plain, html ? "none" : prefs.wrap);
      if (!wrapped.trim() && !html?.replace(/<[^>]+>/g, "").trim()) throw new Error("Message is empty");
      if ((encrypt || sign) && !getUnlocked() && sign) throw new Error("Unlock your private key on the Keys tab first");
      const payload = await encryptAndWrap({
        text: wrapped,
        from: { email: session.email, name: session.name },
        to: toList,
        cc: ccList,
        subject,
        sign,
        encrypt,
        inReplyTo: forward ? undefined : replyTo?.messageId,
        references: [replyTo?.references, replyTo?.messageId].filter(Boolean).join(" ") || undefined,
      });
      await api.send({
        to: toList,
        cc: ccList,
        subject,
        inReplyTo: forward ? undefined : replyTo?.messageId,
        references: [replyTo?.references, replyTo?.messageId].filter(Boolean).join(" ") || undefined,
        formatFlowed: !html && !encrypt && prefs.wrap === "flowed",
        dateUtc: prefs.dateUtc,
        html: html && !("raw" in payload) ? html : undefined,
        ...payload,
      });
      onSent();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const title = forward ? "Forward" : replyTo ? "Reply" : "Compose";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={submit}>
          {err && <div className="err">{err}</div>}
          <label className="field">
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} onBlur={onToBlur} required />
          </label>
          <label className="field">
            <span>Cc</span>
            <input value={cc} onChange={(e) => setCc(e.target.value)} />
          </label>
          <label className="field">
            <span>Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </label>
          <div className="row">
            <label className="check">
              <input
                type="radio"
                name="fmt"
                checked={format === "plain"}
                onChange={() => setFormat("plain")}
              />
              Plain text
            </label>
            <label className="check">
              <input
                type="radio"
                name="fmt"
                checked={format === "html"}
                onChange={() => {
                  setFormat("html");
                  requestAnimationFrame(() => {
                    if (htmlRef.current && !htmlRef.current.innerHTML) htmlRef.current.innerHTML = text.replace(/\n/g, "<br>");
                  });
                }}
                disabled={encrypt}
              />
              HTML
            </label>
          </div>
          {format === "html" && !encrypt ? (
            <label className="field">
              <span>Message</span>
              <div
                ref={htmlRef}
                className="html-editor"
                contentEditable
                role="textbox"
                aria-label="Message"
                onInput={() => setText(htmlToText(htmlRef.current?.innerHTML || ""))}
              />
            </label>
          ) : (
            <label className="field">
              <span>Message</span>
              <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} required />
            </label>
          )}
          {lookup && <div className="note">{lookup}</div>}
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={encrypt}
                onChange={(e) => {
                  setEncrypt(e.target.checked);
                  if (e.target.checked) setFormat("plain");
                }}
              />
              Encrypt
            </label>
            <label className="check">
              <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)} />
              Sign
            </label>
            <button className="btn seal" disabled={busy}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
