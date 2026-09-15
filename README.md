# Hatsu | 初

```
   ┌─────────┐
   │ ✉  はつ │
   │  ╲___╱  │
   └────V────┘

```

A small webmail that talks to your IMAP, SMTP, CalDAV and CardDAV servers. OpenPGP keys stay in the browser.

It is meant to feel like [Alps](https://git.sr.ht/~migadu/alps) or Rainloop: one container, no mail store of its own.

## What it does

- Read, search, reply, send, star, delete against an external IMAP/SMTP account
- Detect common providers (Migadu, Fastmail, Gmail, iCloud, …) and RFC 6186 SRV records
- Generate, import, encrypt, decrypt, sign, verify with [OpenPGP.js](https://openpgpjs.org/) in the browser
- Discover public keys over WKD and HKP (`keys.openpgp.org`)
- Import keys from CardDAV `KEY` fields or by looking up a contact’s email
- Month calendar against CalDAV, including RRULE expansion
- Accept / decline / tentative on `text/calendar` invitations, store the event, send an iTIP REPLY

Private keys never leave the browser. IndexedDB holds the armored secret; a passphrase unwraps it only in memory.

## Run with Docker

```bash
docker compose up --build
```

That starts **Hatsu + GreenMail + Radicale** on one network. Open http://localhost:8080 — the login form is pre-filled.

| | host *(from inside the Hatsu container)* | port | TLS |
|---|---|---|---|
| IMAP | `greenmail` | 3143 | no |
| SMTP | `greenmail` | 3025 | no |
| CalDAV / CardDAV | `http://radicale:5232` | | |

Any email/password works against GreenMail (`demo@example.com` / `demo` is the default).

`ENOTFOUND greenmail` means Hatsu could not see the GreenMail container: you started only the `hatsu` image, or you typed `greenmail` while running Hatsu on the host. The IMAP hostname is resolved **by the Hatsu process**, not by your browser.

- Compose (default): host `greenmail`, port `3143`
- Hatsu on the host (`npm start`) with compose GreenMail published: host `127.0.0.1`, port `3143`
- Do not use `localhost` inside the Hatsu container — that is the container itself

To run Hatsu alone against a real mailbox, drop the extra services or override env and fill IMAP/SMTP yourself.

## Run without Docker

```bash
npm install
npm run dev
```

API on :8080, Vite UI on :5173 (proxies `/api`). Production-style:

```bash
npm run build
npm start
```

## Login notes

- **Gmail / Google Workspace**: enable IMAP and use an [app password](https://support.google.com/accounts/answer/185833).
- **iCloud**: app-specific password.
- **Proton**: point IMAP/SMTP at [Proton Bridge](https://proton.me/mail/bridge), not `proton.me`.
- SMTP submission uses **465** (implicit TLS) or **587** (STARTTLS). Port 25 is not used.
- Check **Allow insecure TLS** only for lab servers with a self-signed cert.

## Layout

```
src/server   IMAP / SMTP / DAV / WKD-HKP proxy
src/web      SPA (mail, calendar, contacts, keys)
```

Sessions live in memory in the container (30 min idle). Put Caddy or nginx in front for TLS.

## License

MIT
