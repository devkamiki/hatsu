import { useState } from "react";
import { api, type Discovery, type SessionInfo } from "./api";

export function Login({ onIn }: { onIn: (s: SessionInfo) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [caldav, setCaldav] = useState("");
  const [carddav, setCarddav] = useState("");
  const [insecure, setInsecure] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function apply(d: Discovery) {
    setImapHost(d.imap.host);
    setImapPort(String(d.imap.port));
    setSmtpHost(d.smtp.host);
    setSmtpPort(String(d.smtp.port));
    setCaldav(d.caldav || "");
    setCarddav(d.carddav || "");
    setNotes(d.notes || []);
    setAdvanced(true);
  }

  async function detect() {
    setErr("");
    try {
      apply(await api.discover(email));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const s = await api.login({
        email,
        password,
        name: name || undefined,
        imap: imapHost ? { host: imapHost, port: Number(imapPort), secure: Number(imapPort) === 993 } : undefined,
        smtp: smtpHost ? { host: smtpHost, port: Number(smtpPort), secure: Number(smtpPort) === 465 } : undefined,
        caldav: caldav || undefined,
        carddav: carddav || undefined,
        tlsInsecure: insecure,
      });
      onIn(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setAdvanced(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <div className="seal">初</div>
          <div>
            <h1>Hatsu</h1>
            <p>Mail, keys, calendar. Your servers.</p>
          </div>
        </div>
        <form onSubmit={submit}>
          {err && <div className="err">{err}</div>}
          <label className="field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="username" />
          </label>
          <label className="field">
            <span>Password</span>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required autoComplete="current-password" />
          </label>
          <label className="field">
            <span>Display name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" />
          </label>
          <div className="row">
            <button type="button" className="btn ghost small" onClick={detect} disabled={!email.includes("@")}>
              Detect servers
            </button>
            <button type="button" className="btn ghost small" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "Hide servers" : "Servers"}
            </button>
          </div>
          {notes.map((n) => (
            <div className="note" key={n}>
              {n}
            </div>
          ))}
          {advanced && (
            <>
              <div className="grid2">
                <label className="field">
                  <span>IMAP host</span>
                  <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
                </label>
                <label className="field">
                  <span>IMAP port</span>
                  <input value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
                </label>
                <label className="field">
                  <span>SMTP host</span>
                  <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
                </label>
                <label className="field">
                  <span>SMTP port</span>
                  <input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                </label>
              </div>
              <label className="field">
                <span>CalDAV URL</span>
                <input value={caldav} onChange={(e) => setCaldav(e.target.value)} placeholder="https://caldav.example.com" />
              </label>
              <label className="field">
                <span>CardDAV URL</span>
                <input value={carddav} onChange={(e) => setCarddav(e.target.value)} placeholder="https://carddav.example.com" />
              </label>
              <label className="check">
                <input type="checkbox" checked={insecure} onChange={(e) => setInsecure(e.target.checked)} />
                Allow insecure TLS
              </label>
            </>
          )}
          <button className="btn seal" disabled={busy}>
            {busy ? "Connecting…" : "Open mailbox"}
          </button>
        </form>
      </div>
    </div>
  );
}
