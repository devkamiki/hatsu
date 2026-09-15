import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assembleBody, forwardSubject, quotePlain, rfc2822Utc, wrapText } from "../shared/composeText.ts";

const msg = {
  from: [{ name: "Ada", address: "ada@example.com" }],
  to: [{ address: "bob@example.com" }],
  date: "2024-01-15T15:00:00.000Z",
  subject: "Hello",
  text: "Line one\nLine two",
};

describe("quotePlain", () => {
  it("uses a casual iCloud attribution and > prefixes", () => {
    const q = quotePlain(msg, "icloud", true);
    assert.match(q, /^On Jan 15, 2024, at /);
    assert.match(q, /Ada <ada@example.com> wrote:/);
    assert.match(q, /> Line one/);
    assert.match(q, /> Line two/);
  });

  it("uses a detailed Outlook original-message block", () => {
    const q = quotePlain(msg, "outlook", true);
    assert.match(q, /-----Original Message-----/);
    assert.match(q, /From: Ada <ada@example.com>/);
    assert.match(q, /Sent: /);
    assert.match(q, /To: bob@example.com/);
    assert.match(q, /Subject: Hello/);
    assert.match(q, /Line one\nLine two/);
    assert.doesNotMatch(q, /^> Line one/m);
  });
});

describe("assembleBody", () => {
  it("places the reply above or below the quote", () => {
    assert.equal(assembleBody("Thanks", "quoted", "above", false), "Thanks\n\nquoted");
    assert.equal(assembleBody("Thanks", "quoted", "below", false), "quoted\n\nThanks");
  });
});

describe("wrapText", () => {
  it("hard-wraps at 78 columns", () => {
    const line = "alpha ".repeat(20).trim();
    const wrapped = wrapText(line, "wrap", 20);
    for (const l of wrapped.split("\n")) assert.ok(l.length <= 20, l);
  });

  it("marks format=flowed soft breaks with a trailing space", () => {
    const line = "alpha ".repeat(20).trim();
    const wrapped = wrapText(line, "flowed", 20).split("\n");
    assert.ok(wrapped.length > 1);
    for (const l of wrapped.slice(0, -1)) assert.match(l, / $/);
  });
});

describe("forwardSubject", () => {
  it("prefixes Fw: once", () => {
    assert.equal(forwardSubject("Hello"), "Fw: Hello");
    assert.equal(forwardSubject("Fw: Hello"), "Fw: Hello");
  });
});

describe("rfc2822Utc", () => {
  it("emits +0000", () => {
    assert.match(rfc2822Utc(new Date("2024-01-15T15:04:05Z")), /15 Jan 2024 15:04:05 \+0000/);
  });
});
