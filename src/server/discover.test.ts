import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mxIspCandidates, parseOutlookXml, parseThunderbirdXml } from "./discover.ts";

const TB = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.org">
    <incomingServer type="imap">
      <hostname>imap.example.org</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.org</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
    </outgoingServer>
    <incomingServer type="caldav">
      <hostname>dav.example.org</hostname>
      <port>443</port>
      <socketType>SSL</socketType>
    </incomingServer>
    <incomingServer type="carddav">
      <hostname>dav.example.org</hostname>
      <port>443</port>
    </incomingServer>
  </emailProvider>
</clientConfig>`;

const OUTLOOK = `<?xml version="1.0"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <Account>
      <Protocol>
        <Type>IMAP</Type>
        <Server>imap.contoso.com</Server>
        <Port>993</Port>
        <SSL>on</SSL>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>smtp.contoso.com</Server>
        <Port>587</Port>
        <SSL>on</SSL>
        <Encryption>TLS</Encryption>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>`;

describe("parseThunderbirdXml", () => {
  it("reads IMAP, SMTP and DAV from config-v1.1.xml", () => {
    const d = parseThunderbirdXml(TB);
    assert.deepEqual(d?.imap, { host: "imap.example.org", port: 993, secure: true });
    assert.deepEqual(d?.smtp, { host: "smtp.example.org", port: 587, secure: false });
    assert.equal(d?.caldav, "https://dav.example.org");
    assert.equal(d?.carddav, "https://dav.example.org");
  });

  it("returns null for unrelated xml", () => {
    assert.equal(parseThunderbirdXml("<html>nope</html>"), null);
  });
});

describe("parseOutlookXml", () => {
  it("reads IMAP/SMTP from autodiscover.xml", () => {
    const d = parseOutlookXml(OUTLOOK);
    assert.deepEqual(d?.discovery.imap, { host: "imap.contoso.com", port: 993, secure: true });
    assert.deepEqual(d?.discovery.smtp, { host: "smtp.contoso.com", port: 587, secure: false });
  });

  it("follows redirectAddr", () => {
    const d = parseOutlookXml(`<Autodiscover><Account><RedirectAddr>user@hosted.example</RedirectAddr></Account></Autodiscover>`);
    assert.equal(d?.redirectAddr, "user@hosted.example");
  });
});

describe("mxIspCandidates", () => {
  it("walks google MX hosts toward the ISPDB domain", () => {
    assert.deepEqual(mxIspCandidates("aspmx.l.google.com.", "corp.example"), [
      "aspmx.l.google.com",
      "l.google.com",
      "google.com",
    ]);
  });
});
