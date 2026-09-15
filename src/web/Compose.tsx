import { useEffect, useState } from "react";
import { api, type Message, type SessionInfo } from "./api";
import { encryptAndWrap, getUnlocked } from "./pgp";

export function Compose({
  session,
  replyTo,
  onClose,
  onSent,
}: {
  session: SessionInfo;
  replyTo?: Message;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [sign, setSign] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    if (!replyTo) return;
    const dest = (replyTo.replyTo.length ? replyTo.replyTo : replyTo.from).map((a) => a.address).join(", ");
    setTo(dest);
    setSubject(replyTo.subject.toLowerCase().startsWith("re:") ? replyTo.subject : `Re: ${replyTo.subject}`);
    const quote = (replyTo.text || "").split("\n").map((l) => `> ${l}`).join("\n");
    setText(`\n\n${quote}`);
  }, [replyTo]);

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
      if ((encrypt || sign) && !getUnlocked() && sign) throw new Error("Unlock your private key on the Keys tab first");
      const wrapped = await encryptAndWrap({
        text,
        from: { email: session.email, name: session.name },
        to: toList,
        cc: ccList,
        subject,
        sign,
        encrypt,
        inReplyTo: replyTo?.messageId,
        references: [replyTo?.references, replyTo?.messageId].filter(Boolean).join(" ") || undefined,
      });
      await api.send({
        to: toList,
        cc: ccList,
        subject,
        inReplyTo: replyTo?.messageId,
        references: [replyTo?.references, replyTo?.messageId].filter(Boolean).join(" ") || undefined,
        ...wrapped,
      });
      onSent();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2>{replyTo ? "Reply" : "Compose"}</h2>
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
          <label className="field">
            <span>Message</span>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} required />
          </label>
          {lookup && <div className="note">{lookup}</div>}
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
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
