import { useEffect, useState } from "react";
import { api, type SessionInfo } from "./api";
import {
  defaultFingerprint,
  deleteKey,
  generateKey,
  getUnlocked,
  importArmored,
  listKeys,
  lockPrivate,
  setDefaultFingerprint,
  type StoredKey,
  unlockPrivate,
} from "./pgp";

export function Keys({ session }: { session: SessionInfo }) {
  const [keys, setKeys] = useState<StoredKey[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [name, setName] = useState(session.name || "");
  const [email, setEmail] = useState(session.email);
  const [pass, setPass] = useState("");
  const [importText, setImportText] = useState("");
  const [lookup, setLookup] = useState("");
  const [unlockFp, setUnlockFp] = useState(defaultFingerprint() || "");
  const [unlockPass, setUnlockPass] = useState("");
  const [, setTick] = useState(0);
  const unlocked = getUnlocked();

  async function refresh() {
    setKeys(await listKeys());
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="card-list">
      {err && <div className="err">{err}</div>}
      {msg && <div className="note">{msg}</div>}
      <div className="card">
        <h3>Private key</h3>
        <p className="note">
          Keys live in this browser (IndexedDB). The server never sees your passphrase or unwrapped private key.
        </p>
        {unlocked ? (
          <div className="row">
            <span className="badge ok">unlocked {unlocked.fingerprint.slice(0, 8)}</span>
            <button className="btn ghost small" onClick={() => { lockPrivate(); setTick((n) => n + 1); setMsg("Locked"); }}>
              Lock
            </button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await unlockPrivate(unlockFp, unlockPass);
                setUnlockPass("");
                setTick((n) => n + 1);
                setMsg("Private key unlocked for this session");
                await refresh();
              } catch (er) {
                setErr(er instanceof Error ? er.message : String(er));
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
          >
            <label className="field">
              <span>Key</span>
              <select value={unlockFp} onChange={(e) => setUnlockFp(e.target.value)}>
                <option value="">select…</option>
                {keys.filter((k) => k.privateArmored).map((k) => (
                  <option key={k.fingerprint} value={k.fingerprint}>
                    {k.name} {k.fingerprint.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Passphrase</span>
              <input type="password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} />
            </label>
            <button className="btn small">Unlock</button>
          </form>
        )}
      </div>

      <div className="card">
        <h3>Generate</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr("");
            try {
              const k = await generateKey(name || session.email, email, pass);
              setPass("");
              setMsg(`Generated ${k.fingerprint}`);
              setUnlockFp(k.fingerprint);
              await refresh();
            } catch (er) {
              setErr(er instanceof Error ? er.message : String(er));
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}
        >
          <div className="grid2">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
          </div>
          <label className="field">
            <span>Passphrase</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} required />
          </label>
          <button className="btn small">Create key</button>
        </form>
      </div>

      <div className="card">
        <h3>Import</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const k = await importArmored(importText);
              setImportText("");
              setMsg(`Imported ${k.fingerprint}`);
              await refresh();
            } catch (er) {
              setErr(er instanceof Error ? er.message : String(er));
            }
          }}
        >
          <label className="field">
            <span>Armored key</span>
            <textarea rows={6} value={importText} onChange={(e) => setImportText(e.target.value)} required />
          </label>
          <button className="btn small" style={{ marginTop: "0.6rem" }}>
            Import
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Discover</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const { key } = await api.lookupKey(lookup);
              if (!key) {
                setErr("No key via WKD or HKP");
                return;
              }
              const k = await importArmored(key.armored, key.source);
              setMsg(`Found via ${key.source}: ${k.fingerprint}`);
              await refresh();
            } catch (er) {
              setErr(er instanceof Error ? er.message : String(er));
            }
          }}
          className="row"
        >
          <label className="field" style={{ flex: 1 }}>
            <span>Email</span>
            <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="alice@example.com" />
          </label>
          <button className="btn small">WKD / HKP</button>
        </form>
      </div>

      {keys.map((k) => (
        <div className="card" key={k.fingerprint}>
          <h3>
            {k.name} {k.privateArmored ? <span className="badge">secret</span> : <span className="badge">public</span>}
          </h3>
          <div className="note">{k.emails.join(" · ")} · {k.source}</div>
          <div className="mono">{k.fingerprint}</div>
          <div className="actions">
            <button className="btn ghost small" onClick={() => { setDefaultFingerprint(k.fingerprint); setMsg("Default key set"); }}>
              Use to sign
            </button>
            <button
              className="btn ghost small"
              onClick={() => navigator.clipboard.writeText(k.publicArmored).then(() => setMsg("Public key copied"))}
            >
              Copy public
            </button>
            <button className="btn ghost small" onClick={() => deleteKey(k.fingerprint).then(refresh)}>
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
