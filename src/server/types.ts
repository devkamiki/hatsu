export type Addr = { name?: string; address: string };

export type ServerCfg = {
  host: string;
  port: number;
  secure: boolean;
};

export type Discovery = {
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  notes: string[];
};

export type LoginBody = {
  email: string;
  password: string;
  name?: string;
  imap?: Partial<ServerCfg>;
  smtp?: Partial<ServerCfg>;
  caldav?: string;
  carddav?: string;
  tlsInsecure?: boolean;
};

export type SessionInfo = {
  email: string;
  name?: string;
  imap: ServerCfg;
  smtp: ServerCfg;
  caldav?: string;
  carddav?: string;
  tlsInsecure: boolean;
};

export type Mailbox = {
  path: string;
  name: string;
  delimiter: string;
  specialUse?: string;
  flags: string[];
  messages?: number;
  unseen?: number;
};

export type MessageSummary = {
  uid: number;
  seq: number;
  flags: string[];
  date?: string;
  size?: number;
  subject: string;
  from: Addr[];
  to: Addr[];
  hasAttachment: boolean;
};

export type AttachmentMeta = {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  partId?: string;
};

export type PgpHint = {
  encrypted: boolean;
  signed: boolean;
  armored?: string;
  cleartext?: string;
};

export type InviteHint = {
  uid: string;
  summary: string;
  dtstart: string;
  dtend?: string;
  allDay?: boolean;
  location?: string;
  organizer?: Addr;
  method?: string;
  ics: string;
};
