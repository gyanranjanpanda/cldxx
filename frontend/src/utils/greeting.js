import { Sunrise, Sun, Sunset, Moon, Star } from "lucide-react";

// The empty state greets by name, and the second half shifts with the clock —
// a 2am visit and a Monday-morning one should not read identically. Pools are
// deliberately short so a phrase feels chosen rather than randomly generated.
const MOODS = [
  {
    id: "dawn",
    // [from, until) in 24h local time
    range: [5, 8],
    icon: Sunrise,
    accent: "from-amber-300 via-orange-300 to-rose-300",
    iconColor: "text-amber-300",
    lines: [
      "Early start. What's first?",
      "The day's still quiet — let's use it.",
      "Up before the rush. What are we building?",
      "Fresh page. Where do we begin?"
    ]
  },
  {
    id: "morning",
    range: [8, 12],
    icon: Sun,
    accent: "from-amber-200 via-yellow-200 to-lime-200",
    iconColor: "text-amber-200",
    lines: [
      "Ready to dive in?",
      "What are we building today?",
      "Good morning — what's on deck?",
      "Let's make something.",
      "What's the first move?"
    ]
  },
  {
    id: "afternoon",
    range: [12, 17],
    icon: Sun,
    accent: "from-sky-300 via-cyan-300 to-teal-200",
    iconColor: "text-sky-300",
    lines: [
      "What's next on the list?",
      "Back at it — what do you need?",
      "Let's pick up where you left off.",
      "Got something to untangle?",
      "What are we shipping?"
    ]
  },
  {
    id: "evening",
    range: [17, 22],
    icon: Sunset,
    accent: "from-orange-300 via-rose-300 to-fuchsia-300",
    iconColor: "text-rose-300",
    lines: [
      "Winding down or just getting started?",
      "Evening session — what's the plan?",
      "One more thing before you log off?",
      "What are we finishing tonight?"
    ]
  },
  {
    id: "night",
    range: [22, 5],
    icon: Moon,
    accent: "from-indigo-300 via-violet-300 to-fuchsia-300",
    iconColor: "text-violet-300",
    lines: [
      "Burning the midnight oil?",
      "Late one. What are we working on?",
      "The quiet hours — good for hard problems.",
      "Still up? Let's get it done.",
      "Night shift. What do you need?"
    ]
  }
];

const FALLBACK = {
  id: "default",
  icon: Star,
  accent: "from-indigo-300 via-violet-300 to-fuchsia-300",
  iconColor: "text-indigo-300",
  lines: ["Ready when you are."]
};

// The night bucket wraps past midnight, so it can't be a plain from<=h<until.
const inRange = (hour, [from, until]) =>
  from < until ? hour >= from && hour < until : hour >= from || hour < until;

export const moodFor = (date = new Date()) =>
  MOODS.find((mood) => inRange(date.getHours(), mood.range)) ?? FALLBACK;

// Only the first name — "Gyan ranjan" in a greeting reads like a form field.
export const firstNameOf = (name) =>
  (name || "").trim().split(/\s+/)[0] || "there";

// Remembering the last line here rather than in a ref keeps the caller a plain
// render-time function: React forbids touching refs during render, and a piece
// of state would need an effect to set it.
let lastLine = null;

/**
 * Picks a line for the current mood, skipping the one shown last so opening two
 * new chats in a row doesn't repeat the same sentence.
 */
export const pickGreeting = (name, { date } = {}) => {
  const mood    = moodFor(date);
  const choices = mood.lines.filter((line) => line !== lastLine);
  const pool    = choices.length ? choices : mood.lines;
  const line    = pool[Math.floor(Math.random() * pool.length)];

  lastLine = line;

  return {
    mood:  mood.id,
    icon:  mood.icon,
    accent: mood.accent,
    iconColor: mood.iconColor,
    hey:   `Hey, ${firstNameOf(name)}.`,
    line
  };
};
