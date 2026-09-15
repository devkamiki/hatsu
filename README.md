# Hatsu

A small webmail that talks to **your** IMAP, SMTP, CalDAV and CardDAV servers. OpenPGP keys stay in the browser.

It is meant to feel like [ALPS](https://github.com/migadu/alps) or Rainloop: one container, no mail store of its own.

## What it does

- Read, search, reply, send, star, delete against an external IMAP/SMTP account
- Detect common providers (Migadu, Fastmail, Gmail, iCloud, …) and RFC 6186 SRV records
- Generate, import, encrypt, decrypt, sign, verify with [OpenPGP.js](https://openpgpjs.org/) in the browser
- Discover public keys over **WKD** and **HKP** (`keys.openpgp.org`)
- Import keys from CardDAV `KEY` fields or by looking up a contact’s email
- Month calendar against CalDAV, including RRULE expansion
- Accept / decline / tentative on `text/calendar` invitations, store the event, send an iTIP REPLY

Private keys never leave the browser. IndexedDB holds the armored secret; a passphrase unwraps it only in memory.

## Run with Docker

```bash
docker compose up --build
```

Open http://localhost:8080 and sign in with a real mailbox.

Optional local IMAP/SMTP + CalDAV for demos:

```bash
docker compose --profile demo up --build
```

Then in Hatsu (the **server** resolves these hostnames):

| | host | port | TLS |
|---|---|---|---|
| IMAP | `greenmail` | 3993 | yes |
| SMTP | `greenmail` | 3465 | yes |
| CalDAV / CardDAV | `http://radicale:5232` | | |

GreenMail accepts any `user@host` / password pair. If you run Hatsu with `npm start` on the host instead of Compose, use `localhost` and the published ports.

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
