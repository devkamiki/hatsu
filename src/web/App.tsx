import { useEffect, useState } from "react";
import { api, type SessionInfo } from "./api";
import { Calendar } from "./Calendar";
import { Contacts } from "./Contacts";
import { Keys } from "./Keys";
import { Login } from "./Login";
import { Mail } from "./Mail";
import { lockPrivate } from "./pgp";
import { loadComposePrefs, saveComposePrefs, type ComposePrefs } from "./prefs";

type Tab = "mail" | "calendar" | "contacts" | "keys";

export function App() {
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("mail");
  const [settings, setSettings] = useState(false);
  const [caldav, setCaldav] = useState("");
  const [carddav, setCarddav] = useState("");
  const [davSeparate, setDavSeparate] = useState(false);
  const [davUser, setDavUser] = useState("");
  const [davPassword, setDavPassword] = useState("");
  const [theme, setTheme] = useState(localStorage.getItem("hatsu-theme") || "");
  const [composePrefs, setComposePrefs] = useState<ComposePrefs>(() => loadComposePrefs());

  useEffect(() => {
    api
      .session()
      .then((s) => {
        setSession(s);
        setCaldav(s.caldav || "");
        setCarddav(s.carddav || "");
        setDavSeparate(s.davSeparate);
        setDavUser(s.davUser || s.email);
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
  if (!session) {
    return (
      <Login
        onIn={(s) => {
          setSession(s);
          setCaldav(s.caldav || "");
          setCarddav(s.carddav || "");
          setDavSeparate(s.davSeparate);
          setDavUser(s.davUser || s.email);
          setDavPassword("");
        }}
      />
    );
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand" style={{ margin: 0 }}>
          <span className="seal">初</span>
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
                saveComposePrefs(composePrefs);
                const s = await api.settings({
                  caldav,
                  carddav,
                  davSeparate,
                  davUser: davSeparate ? davUser || undefined : undefined,
                  davPassword: davSeparate ? davPassword || undefined : undefined,
                });
                setSession(s);
                setDavPassword("");
                setSettings(false);
              }}
              style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}
            >
              <label className="check">
                <input type="checkbox" checked={davSeparate} onChange={(e) => setDavSeparate(e.target.checked)} />
                Calendar and contacts are on a different server
              </label>
              <label className="field">
                <span>CalDAV</span>
                <input value={caldav} onChange={(e) => setCaldav(e.target.value)} placeholder="https://dav.fruux.com" />
              </label>
              <label className="field">
                <span>CardDAV</span>
                <input value={carddav} onChange={(e) => setCarddav(e.target.value)} placeholder="https://dav.fruux.com" />
              </label>
              {davSeparate && (
                <>
                  <label className="field">
                    <span>DAV username</span>
                    <input value={davUser} onChange={(e) => setDavUser(e.target.value)} autoComplete="off" />
                  </label>
                  <label className="field">
                    <span>DAV password</span>
                    <input
                      type="password"
                      value={davPassword}
                      onChange={(e) => setDavPassword(e.target.value)}
                      placeholder="leave blank to keep"
                      autoComplete="off"
                    />
                  </label>
                </>
              )}
              <div className="note">
                IMAP {session.imap.host}:{session.imap.port} · SMTP {session.smtp.host}:{session.smtp.port}
              </div>
              <h3>Compose</h3>
              <label className="field">
                <span>Default format</span>
                <select
                  value={composePrefs.format}
                  onChange={(e) => setComposePrefs({ ...composePrefs, format: e.target.value as ComposePrefs["format"] })}
                >
                  <option value="plain">Plain text</option>
                  <option value="html">HTML</option>
                </select>
              </label>
              <label className="field">
                <span>Plain text wrapping</span>
                <select
                  value={composePrefs.wrap}
                  onChange={(e) => setComposePrefs({ ...composePrefs, wrap: e.target.value as ComposePrefs["wrap"] })}
                >
                  <option value="flowed">format=flowed</option>
                  <option value="wrap">Hard wrap at 78</option>
                  <option value="none">Do not wrap</option>
                </select>
              </label>
              <label className="field">
                <span>Reply position</span>
                <select
                  value={composePrefs.replyPosition}
                  onChange={(e) =>
                    setComposePrefs({ ...composePrefs, replyPosition: e.target.value as ComposePrefs["replyPosition"] })
                  }
                >
                  <option value="above">Reply above the original</option>
                  <option value="below">Reply under the original</option>
                </select>
              </label>
              <label className="field">
                <span>Quote style</span>
                <select
                  value={composePrefs.quoteStyle}
                  onChange={(e) =>
                    setComposePrefs({ ...composePrefs, quoteStyle: e.target.value as ComposePrefs["quoteStyle"] })
                  }
                >
                  <option value="icloud">iCloud — On … someone wrote:</option>
                  <option value="outlook">Outlook — original message headers</option>
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={composePrefs.dateUtc}
                  onChange={(e) => setComposePrefs({ ...composePrefs, dateUtc: e.target.checked })}
                />
                Write Date headers as UTC
              </label>
              <button className="btn">Save</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
