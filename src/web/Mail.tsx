import { useEffect, useMemo, useState } from "react";
import { api, fmtAddr, fmtDate, type Mailbox, type Message, type MessageSummary, type SessionInfo } from "./api";
import { Compose } from "./Compose";
import { decryptOrVerify, type CryptoResult } from "./pgp";

export function Mail({ session }: { session: SessionInfo }) {
  const [boxes, setBoxes] = useState<Mailbox[]>([]);
  const [mailbox, setMailbox] = useState("INBOX");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [exists, setExists] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Message | null>(null);
  const [crypto, setCrypto] = useState<CryptoResult | null>(null);
  const [err, setErr] = useState("");
  const [compose, setCompose] = useState(false);
  const [reply, setReply] = useState<Message | undefined>();
  const [forward, setForward] = useState(false);
  const [cals, setCals] = useState<{ url: string; displayName: string }[]>([]);
  const [inviteCal, setInviteCal] = useState("");
  const [busyInvite, setBusyInvite] = useState(false);

  async function loadBoxes() {
    const { mailboxes } = await api.mailboxes();
    setBoxes(mailboxes);
    if (!mailboxes.some((m) => m.path === mailbox) && mailboxes[0]) setMailbox(mailboxes[0].path);
  }

  async function loadList(box = mailbox, p = page, query = q) {
    const res = await api.messages(box, p, query || undefined);
    setMessages(res.messages);
    setExists(res.exists);
  }

  useEffect(() => {
    loadBoxes().catch((e) => setErr(e.message));
    api
      .calendars()
      .then((r) => {
        setCals(r.calendars);
        if (r.calendars[0]) setInviteCal(r.calendars[0].url);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setActive(null);
    setCrypto(null);
    loadList(mailbox, 1, q).catch((e) => setErr(e.message));
    setPage(1);
  }, [mailbox]);

  async function open(uid: number) {
    setErr("");
    const msg = await api.message(mailbox, uid);
    setActive(msg);
    setCrypto(null);
    if (msg.pgp.encrypted || msg.pgp.signed) {
      const result = await decryptOrVerify(msg.pgp);
      setCrypto(result);
    }
    loadList().catch(() => undefined);
  }

  async function respond(action: "accept" | "decline" | "tentative") {
    if (!active?.invite) return;
    setBusyInvite(true);
    try {
      await api.inviteRespond({ mailbox, uid: active.uid, action, calendarUrl: inviteCal || undefined });
      setErr("");
      alert(action === "accept" ? "Accepted and filed on the calendar" : action === "decline" ? "Declined" : "Marked tentative");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyInvite(false);
    }
  }

  const unread = useMemo(() => new Set(messages.filter((m) => !m.flags.includes("\\Seen")).map((m) => m.uid)), [messages]);

  return (
    <div className={`mail ${active ? "show-read" : ""}`}>
      <aside className="folders">
        <button className="btn seal" style={{ width: "100%", marginBottom: "0.8rem" }} onClick={() => { setReply(undefined); setForward(false); setCompose(true); }}>
          Compose
        </button>
        {boxes.map((b) => (
          <button key={b.path} className={`folder ${b.path === mailbox ? "on" : ""}`} onClick={() => setMailbox(b.path)}>
            <span>{b.name}</span>
            {!!b.unseen && <span className="unseen">{b.unseen}</span>}
          </button>
        ))}
      </aside>
      <section className="list">
        <div className="list-head">
          <input
            placeholder="Search this folder"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadList(mailbox, 1, q).catch((er) => setErr(er.message));
            }}
          />
          <button className="btn ghost small" onClick={() => loadList().catch((e) => setErr(e.message))}>
            Refresh
          </button>
        </div>
        {messages.map((m) => (
          <button
            key={m.uid}
            className={`msg ${active?.uid === m.uid ? "on" : ""} ${unread.has(m.uid) ? "unread" : ""}`}
            onClick={() => open(m.uid).catch((e) => setErr(e.message))}
          >
            <div className="from">
              <span>{m.from[0] ? fmtAddr(m.from[0]) : "(unknown)"}</span>
              <span>{fmtDate(m.date)}{m.hasAttachment ? " 📎" : ""}</span>
            </div>
            <div className="sub">{m.subject}</div>
          </button>
        ))}
        {!messages.length && <div className="empty">No messages</div>}
        <div className="row" style={{ padding: "0.6rem" }}>
          <button className="btn ghost small" disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); loadList(mailbox, p).catch((e) => setErr(e.message)); }}>
            Newer
          </button>
          <span className="note">{exists} messages</span>
          <button className="btn ghost small" onClick={() => { const p = page + 1; setPage(p); loadList(mailbox, p).catch((e) => setErr(e.message)); }}>
            Older
          </button>
        </div>
      </section>
      <article className="read">
        {err && <div className="err">{err}</div>}
        {!active && <div className="empty">Select a message</div>}
        {active && (
          <>
            <button className="btn ghost small" onClick={() => setActive(null)} style={{ marginBottom: "0.6rem" }}>
              Back
            </button>
            <h2>{active.subject}</h2>
            <div className="meta">
              <div>From {active.from.map(fmtAddr).join(", ")}</div>
              <div>To {active.to.map(fmtAddr).join(", ")}</div>
              {!!active.cc.length && <div>Cc {active.cc.map(fmtAddr).join(", ")}</div>}
              <div>{fmtDate(active.date)}</div>
              {active.pgp.encrypted && <span className="badge">PGP encrypted</span>}
              {active.pgp.signed && <span className="badge">PGP signed</span>}
              {crypto?.valid === true && <span className="badge ok">signature valid {crypto.signedBy || ""}</span>}
              {crypto?.valid === false && <span className="badge bad">signature invalid</span>}
              {crypto?.error && <span className="badge warn">{crypto.error}</span>}
            </div>
            <div className="actions">
              <button className="btn small" onClick={() => { setReply(active); setForward(false); setCompose(true); }}>
                Reply
              </button>
              <button className="btn ghost small" onClick={() => { setReply(active); setForward(true); setCompose(true); }}>
                Forward
              </button>
              <button
                className="btn ghost small"
                onClick={() => api.delete(mailbox, active.uid).then(() => { setActive(null); loadList(); loadBoxes(); })}
              >
                Delete
              </button>
              <button
                className="btn ghost small"
                onClick={() => {
                  const flagged = active.flags.includes("\\Flagged");
                  api.flags(mailbox, active.uid, flagged ? [] : ["\\Flagged"], flagged ? ["\\Flagged"] : []).then(() => open(active.uid));
                }}
              >
                {active.flags.includes("\\Flagged") ? "Unstar" : "Star"}
              </button>
            </div>
            {active.invite && (
              <div className="invite">
                <h3>{active.invite.summary}</h3>
                <div className="note">
                  {fmtDate(active.invite.dtstart)}
                  {active.invite.location ? ` · ${active.invite.location}` : ""}
                  {active.invite.organizer ? ` · from ${fmtAddr(active.invite.organizer)}` : ""}
                </div>
                {!!cals.length && (
                  <label className="field" style={{ margin: "0.6rem 0" }}>
                    <span>Calendar</span>
                    <select value={inviteCal} onChange={(e) => setInviteCal(e.target.value)}>
                      {cals.map((cal) => (
                        <option key={cal.url} value={cal.url}>
                          {cal.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="actions">
                  <button className="btn small seal" disabled={busyInvite} onClick={() => respond("accept")}>
                    Accept
                  </button>
                  <button className="btn ghost small" disabled={busyInvite} onClick={() => respond("tentative")}>
                    Tentative
                  </button>
                  <button className="btn ghost small" disabled={busyInvite} onClick={() => respond("decline")}>
                    Decline
                  </button>
                </div>
              </div>
            )}
            {crypto?.text ? (
              <div className="body">{crypto.text}</div>
            ) : active.html ? (
              <div className="body">
                <iframe
                  title="Message"
                  sandbox=""
                  srcDoc={`<!doctype html><html><head><style>body{font:16px/1.5 system-ui,sans-serif;color:#111;background:transparent}img{max-width:100%}</style></head><body>${active.html}</body></html>`}
                />
              </div>
            ) : (
              <div className="body">{active.text || "(empty)"}</div>
            )}
            {!!active.attachments.length && (
              <div className="attach">
                {active.attachments.map((a) => (
                  <a
                    key={a.filename}
                    href={`/api/attachment?mailbox=${encodeURIComponent(mailbox)}&uid=${active.uid}&filename=${encodeURIComponent(a.filename)}`}
                  >
                    {a.filename}
                  </a>
                ))}
              </div>
            )}
          </>
        )}
      </article>
      {compose && (
        <Compose
          session={session}
          replyTo={reply}
          forward={forward}
          onClose={() => setCompose(false)}
          onSent={() => loadList()}
        />
      )}
    </div>
  );
}
