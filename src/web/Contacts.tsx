import { useEffect, useState } from "react";
import { api, type Contact } from "./api";
import { importArmored } from "./pgp";

export function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api
      .contacts()
      .then((r) => setContacts(r.contacts))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  async function importKey(c: Contact) {
    setMsg("");
    setErr("");
    try {
      const fromCard = c.keys.find((k) => /PGP|BEGIN PGP/i.test(`${k.type} ${k.value}`));
      if (fromCard && /BEGIN PGP/.test(fromCard.value)) {
        const stored = await importArmored(fromCard.value, "contact");
        setMsg(`Imported ${stored.fingerprint} from ${c.fn}`);
        return;
      }
      if (fromCard?.value.startsWith("http")) {
        const res = await fetch(`/api/keys/lookup?email=${encodeURIComponent(c.emails[0] || "")}`);
        const data = await res.json();
        if (data.key) {
          const stored = await importArmored(data.key.armored, "contact");
          setMsg(`Imported ${stored.fingerprint}`);
          return;
        }
      }
      for (const email of c.emails) {
        const { key } = await api.lookupKey(email);
        if (key) {
          const stored = await importArmored(key.armored, key.source);
          setMsg(`Imported ${stored.fingerprint} via ${key.source} for ${email}`);
          return;
        }
      }
      setErr(`No OpenPGP key found for ${c.fn}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (err && !contacts.length) {
    return (
      <div className="empty">
        <div>
          <p>{err}</p>
          <p className="note">Add a CardDAV URL under Settings to load contacts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-list">
      {msg && <div className="note">{msg}</div>}
      {err && <div className="err">{err}</div>}
      {contacts.map((c) => (
        <div className="card" key={c.uid}>
          <h3>{c.fn}</h3>
          <div className="note">{c.emails.join(" · ") || "no email"}</div>
          {!!c.keys.length && <div className="note">vCard has a KEY field</div>}
          <div className="actions">
            <button className="btn ghost small" onClick={() => importKey(c)} disabled={!c.emails.length && !c.keys.length}>
              Import OpenPGP key
            </button>
          </div>
        </div>
      ))}
      {!contacts.length && <div className="empty">No contacts</div>}
    </div>
  );
}
