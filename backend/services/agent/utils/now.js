// The model has no clock. Without an explicit "now" in the prompt it answers
// "I don't have access to live data" to anything time-shaped, and it cannot
// tell a search snippet crawled last week from one crawled an hour ago.

const FALLBACK_ZONE = "UTC";

// Intl throws on a malformed zone, and the timezone arrives from the browser,
// so it is never trusted directly.
const safeZone = (timezone) => {
  if (!timezone || typeof timezone !== "string") return FALLBACK_ZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return FALLBACK_ZONE;
  }
};

export const describeNow = (timezone) => {
  const zone = safeZone(timezone);
  const date = new Date();

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);

  const utc = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);

  return {
    zone,
    iso: date.toISOString(),
    formatted,
    // Given both, the model converts to any other zone by offset arithmetic
    // instead of reaching for a cached world-clock page.
    utc,
    // Anchors a search query to today so the provider biases towards pages
    // published now instead of an evergreen "weather in September" article.
    dateOnly: new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date)
  };
};

// A pure clock question has a correct answer on this machine, so sending it to
// a web search only introduces a stale one: cached time pages carry whatever
// timestamp the crawler saw, which is how "what is current time" came back as
// 14:10 UTC while the real answer was 18:18 UTC.
//
// Anchored to the whole prompt on purpose. An unanchored "time in \w+" also
// swallows "write code that measures time in ms", and a bare leading "what
// time" swallows "what time does the store open" -- both need a real search.
const PLACE = String.raw`(?:\s+(?:in|at|for)\s+[\w\s/,'.-]+)?`;
const TAIL = String.raw`(?:\s+(?:is\s+it|now|right\s+now|today|here))?`;

const CLOCK_QUESTION = new RegExp(
  String.raw`^\s*(?:so\s+|and\s+|hey\s+|please\s+)*` +
    String.raw`(?:` +
    String.raw`(?:what(?:'?s|\s+is|\s+are)?|tell\s+me|give\s+me)\s+(?:the\s+|me\s+the\s+)?(?:current\s+|local\s+|today'?s\s+)?(?:time|date|day)${TAIL}${PLACE}` +
    String.raw`|(?:current|local)\s+(?:time|date|day)${PLACE}` +
    String.raw`|time\s+(?:right\s+)?now${PLACE}` +
    String.raw`|today'?s\s+date` +
    String.raw`|what\s+day\s+is\s+it${TAIL}` +
    String.raw`)` +
    String.raw`\s*[?.!]*\s*$`,
  "i"
);

export const isClockQuestion = (prompt) =>
  typeof prompt === "string" && CLOCK_QUESTION.test(prompt);
