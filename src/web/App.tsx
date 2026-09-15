import { useEffect, useState } from "react";
import { api, type SessionInfo } from "./api";
import { Calendar } from "./Calendar";
import { Contacts } from "./Contacts";
import { Keys } from "./Keys";
import { Login } from "./Login";
import { Mail } from "./Mail";
import { lockPrivate } from "./pgp";

type Tab = "mail" | "calendar" | "contacts" | "keys";

export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("mail");
  const [settings, setSettings] = useState(false);
  const [caldav, setCaldav] = useState("");
  const [carddav, setCarddav] = useState("");
  const [theme, setTheme] = useState(localStorage.getItem("hatsu-theme") || "");

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setSession(s);
        setCaldav(s.caldav || "");
        setCarddav(s.carddav || "");
      })
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    if (theme) localStorage.setItem("hatsu-theme", theme);
    else localStorage.removeItem("hatsu-theme");
  }, [theme]);

  if (session === undefined) return <div className="empty">Opening…</div>;
  if (!session) return <Login onIn={(s) => { setSession(s); setCaldav(s.caldav || ""); setCarddav(s.carddav || ""); }} />;

  return (
    <div className="shell">
      <header className="top">
        <div className="brand" style={{ margin: 0, gap: "0.55rem" }}>
          <div className="seal" style={{ width: 32, height: 32, fontSize: 16, borderRadius: 8 }}>
            初
          </div>
          <strong>Hatsu</strong>
        </div>
        <nav className="tabs">
          {(["mail", "calendar", "contacts", "keys"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="who">{session.email}</span>
        <button className="iconbtn" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "" : "dark")}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <button className="iconbtn" onClick={() => setSettings(true)}>
          Settings
        </button>
        <button
          className="iconbtn"
          onClick={() => {
            lockPrivate();
            api.logout().finally(() => setSession(null));
          }}
        >
          Sign out
        </button>
      </header>
      {tab === "mail" && <Mail session={session} />}
      {tab === "calendar" && <Calendar />}
      {tab === "contacts" && <Contacts />}
      {tab === "keys" && <Keys session={session} />}
      {settings && (
        <div className="overlay" onClick={() => setSettings(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h2>Settings</h2>
              <button className="btn ghost small" onClick={() => setSettings(false)}>
                Close
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const s = await api.settings({ caldav, carddav });
                setSession(s);
                setSettings(false);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}
            >
              <label className="field">
                <span>CalDAV</span>
                <input value={caldav} onChange={(e) => setCaldav(e.target.value)} />
              </label>
              <label className="field">
                <span>CardDAV</span>
                <input value={carddav} onChange={(e) => setCarddav(e.target.value)} />
              </label>
              <div className="note">
                IMAP {session.imap.host}:{session.imap.port} · SMTP {session.smtp.host}:{session.smtp.port}
              </div>
              <button className="btn">Save</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
