import type { QuoteStyle, ReplyPosition, WrapMode } from "../shared/composeText";

export type ComposePrefs = {
  format: "plain" | "html";
  wrap: WrapMode;
  replyPosition: ReplyPosition;
  quoteStyle: QuoteStyle;
  dateUtc: boolean;
};

const KEY = "hatsu-compose";

export const defaultComposePrefs: ComposePrefs = {
  format: "plain",
  wrap: "flowed",
  replyPosition: "above",
  quoteStyle: "icloud",
  dateUtc: false,
};

export function loadComposePrefs(): ComposePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultComposePrefs };
    const parsed = JSON.parse(raw) as Partial<ComposePrefs>;
    return {
      format: parsed.format === "html" ? "html" : "plain",
      wrap: parsed.wrap === "wrap" || parsed.wrap === "none" || parsed.wrap === "flowed" ? parsed.wrap : "flowed",
      replyPosition: parsed.replyPosition === "below" ? "below" : "above",
      quoteStyle: parsed.quoteStyle === "outlook" ? "outlook" : "icloud",
      dateUtc: Boolean(parsed.dateUtc),
    };
  } catch {
    return { ...defaultComposePrefs };
  }
}

export function saveComposePrefs(prefs: ComposePrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
