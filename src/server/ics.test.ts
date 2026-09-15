import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCalendar, buildEventIcs, replyIcs } from "./ics.ts";
import { wkdHash } from "./keys.ts";

describe("ics", () => {
  it("parses a REQUEST event", () => {
    const ics = `BEGIN:VCALENDAR
METHOD:REQUEST
BEGIN:VEVENT
UID:abc-123
DTSTART:20240115T100000Z
DTEND:20240115T110000Z
SUMMARY:Standup
ORGANIZER;CN=Ada:mailto:ada@example.com
ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.com
END:VEVENT
END:VCALENDAR`;
    const [ev] = parseCalendar(ics);
    assert.equal(ev.uid, "abc-123");
    assert.equal(ev.method, "REQUEST");
    assert.equal(ev.summary, "Standup");
    assert.equal(ev.organizer?.email, "ada@example.com");
    assert.equal(ev.attendees[0].email, "bob@example.com");
    assert.equal(ev.dtstart, "2024-01-15T10:00:00Z");
  });

  it("unfolds folded lines", () => {
    const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20240202\r\nSUMMARY:Hello\r\n  world\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const [ev] = parseCalendar(ics);
    assert.equal(ev.summary, "Hello world");
    assert.equal(ev.allDay, true);
    assert.equal(ev.dtstart, "2024-02-02");
  });

  it("builds and re-parses an event", () => {
    const raw = buildEventIcs({
      uid: "u1",
      summary: "Tea, please",
      dtstart: "2024-03-01T15:00:00Z",
      dtend: "2024-03-01T16:00:00Z",
      organizer: { email: "a@b.com", cn: "A" },
    });
    const [ev] = parseCalendar(raw);
    assert.equal(ev.summary, "Tea, please");
    assert.equal(ev.organizer?.email, "a@b.com");
  });

  it("builds a REPLY", () => {
    const [ev] = parseCalendar(`BEGIN:VCALENDAR
METHOD:REQUEST
BEGIN:VEVENT
UID:abc
DTSTART:20240115T100000Z
SUMMARY:X
ORGANIZER:mailto:ada@example.com
ATTENDEE:mailto:bob@example.com
END:VEVENT
END:VCALENDAR`);
    const reply = replyIcs(ev, "bob@example.com", "ACCEPTED");
    assert.match(reply, /METHOD:REPLY/);
    assert.match(reply, /PARTSTAT=ACCEPTED/);
  });
});

describe("wkd hash", () => {
  it("matches GnuPG z-base-32 of SHA-1(local-part)", () => {
    assert.equal(wkdHash("test"), "iffe93qcsgp4c8ncbb378rxjo6cn9q6u");
    assert.equal(wkdHash("aheinecke"), "g8td9rsyatrazsoiho37j9n3g5ypp34h");
  });
});

