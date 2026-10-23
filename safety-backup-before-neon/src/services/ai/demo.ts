import { addDaysToKey, weekdayOfKey } from "../../domain/dates.js";
import type { AiProvider, ProposalInput, ProposalOutput, ProviderInfo, RawPlanAction } from "./types.js";

/**
 * Deterministic demo provider.
 *
 * It performs NO model inference and makes NO network calls: it is a rule-based
 * parser that turns common household phrasing into the same structured proposal
 * a model would produce. It is what keeps the demo reproducible offline, and it
 * is also the automatic fallback whenever a live provider fails.
 */

interface CatalogItem {
  name: string;
  category: string;
  unit: string;
  quantity: number;
  keywords: string[];
}

const CATALOG: CatalogItem[] = [
  { name: "Jasmine rice", category: "Pantry", unit: "kg", quantity: 1, keywords: ["rice", "jasmine"] },
  { name: "Spaghetti", category: "Pantry", unit: "packs", quantity: 2, keywords: ["pasta", "spaghetti", "noodles"] },
  { name: "Marinara sauce", category: "Pantry", unit: "jars", quantity: 1, keywords: ["marinara", "tomato sauce", "pasta sauce"] },
  { name: "Garlic", category: "Produce", unit: "heads", quantity: 2, keywords: ["garlic"] },
  { name: "Yellow onions", category: "Produce", unit: "kg", quantity: 0.5, keywords: ["onion", "onions"] },
  { name: "Baby spinach", category: "Produce", unit: "bags", quantity: 2, keywords: ["spinach", "greens", "salad"] },
  { name: "Lemons", category: "Produce", unit: "pcs", quantity: 4, keywords: ["lemon", "lemons"] },
  { name: "Bell peppers", category: "Produce", unit: "pcs", quantity: 3, keywords: ["pepper", "peppers", "capsicum"] },
  { name: "Parmesan", category: "Dairy & alternatives", unit: "block", quantity: 1, keywords: ["parmesan", "cheese"] },
  { name: "Oat milk (barista)", category: "Dairy & alternatives", unit: "cartons", quantity: 2, keywords: ["oat milk", "milk"] },
  { name: "Eggs", category: "Dairy & alternatives", unit: "dozen", quantity: 1, keywords: ["egg", "eggs"] },
  { name: "Butter", category: "Dairy & alternatives", unit: "packs", quantity: 1, keywords: ["butter"] },
  { name: "Chicken thighs", category: "Meat & fish", unit: "kg", quantity: 1, keywords: ["chicken", "thighs"] },
  { name: "Salmon fillets", category: "Meat & fish", unit: "pcs", quantity: 2, keywords: ["salmon", "fish", "fillet"] },
  { name: "Sparkling water", category: "Beverages", unit: "cans", quantity: 6, keywords: ["sparkling water", "seltzer", "soda water"] },
  { name: "Coffee beans", category: "Beverages", unit: "bags", quantity: 1, keywords: ["coffee", "beans"] },
  { name: "Orange juice", category: "Beverages", unit: "bottles", quantity: 1, keywords: ["orange juice", "juice"] },
  { name: "Sourdough loaf", category: "Bakery", unit: "loaves", quantity: 1, keywords: ["bread", "sourdough", "loaf"] },
  { name: "Vanilla ice cream", category: "Frozen", unit: "tubs", quantity: 1, keywords: ["ice cream", "gelato"] },
  { name: "Dish soap", category: "Household", unit: "bottles", quantity: 1, keywords: ["dish soap", "washing up"] },
  { name: "Paper towels", category: "Household", unit: "rolls", quantity: 1, keywords: ["paper towel", "kitchen roll"] },
  { name: "Trash bags", category: "Household", unit: "rolls", quantity: 1, keywords: ["trash bag", "bin bag", "garbage bag"] },
];

/** Menu-driven shopping: "groceries for dinner" expands to a coherent set. */
const MEAL_SETS: Record<string, string[]> = {
  dinner: ["Jasmine rice", "Baby spinach", "Garlic", "Parmesan", "Lemons", "Sparkling water"],
  breakfast: ["Eggs", "Sourdough loaf", "Butter", "Oat milk (barista)", "Orange juice"],
  lunch: ["Baby spinach", "Sourdough loaf", "Parmesan", "Lemons"],
  party: ["Sparkling water", "Orange juice", "Sourdough loaf", "Parmesan", "Vanilla ice cream"],
};

/** Fallback basket when the user asks for groceries without naming items. */
const STAPLES = ["Oat milk (barista)", "Sourdough loaf", "Eggs", "Baby spinach", "Jasmine rice", "Sparkling water"];

const MEAL_WORDS = /\b(dinner|breakfast|lunch|brunch|party|guests?)\b/i;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function toMinutes(hour: number, minute: number, meridiem?: string): number {
  let h = hour % 12;
  if (meridiem?.toLowerCase().startsWith("p")) h += 12;
  return h * 60 + minute;
}

function minutesToTime(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function prettyTime(time: string): string {
  const [hRaw, mRaw] = time.split(":");
  const h = Number(hRaw);
  const meridiem = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${mRaw} ${meridiem}`;
}

function addDays(date: string, days: number): string {
  return addDaysToKey(date, days);
}

function weekdayIndex(date: string): number {
  return weekdayOfKey(date);
}

/** Next (or same-day) occurrence of a weekday, relative to the reference date. */
function resolveWeekday(target: number, referenceDate: string): string {
  const delta = (target - weekdayIndex(referenceDate) + 7) % 7;
  return addDays(referenceDate, delta);
}

function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function splitClauses(request: string): string[] {
  return request
    .split(
      /[,;]|\.\s+|\s+and\s+(?=(?:add|schedule|remind|plan|clean|buy|book|set|make|prepare|organize|tidy|vacuum|invite|order|pick|drop|water|walk|do|put|take|call|get|shop))/i,
    )
    .map((clause) => clause.trim().replace(/^["']|["']$/g, ""))
    .filter((clause) => clause.length > 1);
}

function findCatalogItems(text: string): CatalogItem[] {
  const lower = text.toLowerCase();
  const found: CatalogItem[] = [];
  for (const item of CATALOG) {
    if (item.keywords.some((keyword) => lower.includes(keyword))) {
      found.push(item);
    }
  }
  return found;
}

function mealFrom(text: string): string | null {
  const match = MEAL_WORDS.exec(text);
  if (!match) return null;
  const word = match[1].toLowerCase();
  if (word === "guests" || word === "party") return "party";
  if (MEAL_SETS[word]) return word;
  return null;
}

interface TimeHint {
  minutes: number;
  explicit: boolean;
  label: string;
}

function parseClockTime(text: string): TimeHint | null {
  const explicit = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i.exec(text);
  if (explicit) {
    const minutes = toMinutes(Number(explicit[1]), Number(explicit[2] ?? 0), explicit[3]);
    return { minutes, explicit: true, label: prettyTime(minutesToTime(minutes)) };
  }
  const twentyFour = /\bat\s+(\d{1,2}):(\d{2})\b/i.exec(text);
  if (twentyFour) {
    const minutes = toMinutes(Number(twentyFour[1]), Number(twentyFour[2]));
    return { minutes, explicit: true, label: prettyTime(minutesToTime(minutes)) };
  }
  const periodMap: Array<[RegExp, number, string]> = [
    [/\bat noon\b/i, 12 * 60, "12:00 PM"],
    [/\bin the (?:early )?morning\b/i, 9 * 60 + 30, "9:30 AM"],
    [/\bthis morning\b/i, 9 * 60 + 30, "9:30 AM"],
    [/\bin the afternoon\b/i, 14 * 60, "2:00 PM"],
    [/\bthis afternoon\b/i, 14 * 60, "2:00 PM"],
    [/\bin the (?:late )?evening\b/i, 18 * 60, "6:00 PM"],
    [/\btonight\b/i, 18 * 60, "6:00 PM"],
    [/\bat night\b/i, 20 * 60, "8:00 PM"],
  ];
  for (const [pattern, minutes, label] of periodMap) {
    if (pattern.test(text)) return { minutes, explicit: false, label };
  }
  return null;
}

function parsePeopleCount(text: string): number | null {
  const words: Array<[RegExp, number]> = [
    [/\bfor two\b|\bfor 2\b|\bfor a couple\b/i, 2],
    [/\bfor three\b|\bfor 3\b/i, 3],
    [/\bfor four\b|\bfor 4\b/i, 4],
    [/\bfor six\b|\bfor 6\b/i, 6],
    [/\bfor eight\b|\bfor 8\b/i, 8],
  ];
  for (const [pattern, count] of words) {
    if (pattern.test(text)) return count;
  }
  return null;
}

export class DemoProvider implements AiProvider {
  info(): ProviderInfo {
    return {
      name: "demo",
      label: "Local planner (no model configured)",
      mode: "demo",
      model: null,
      endpoint: null,
    };
  }

  async health(): Promise<{ available: boolean; detail: string }> {
    return {
      available: true,
      detail: "Built-in rule-based parser — always available, no network or credentials required.",
    };
  }

  async propose(input: ProposalInput): Promise<ProposalOutput> {
    const startedAt = Date.now();
    const extraction = parseRequest(input);
    return { extraction, latencyMs: Date.now() - startedAt };
  }
}

/* -------------------------------------------------------------------------- */

export function parseRequest(input: ProposalInput): {
  title: string;
  summary: string;
  assumptions: string[];
  clarification: string | null;
  actions: RawPlanAction[];
} {
  const { request, referenceDate } = input;
  const clauses = splitClauses(request);
  const actions: RawPlanAction[] = [];
  const assumptions: string[] = [];
  const notes: string[] = [];

  /* ---- global context: which day? ---- */
  let planDate = referenceDate;
  let dateExplicit = false;
  const weekdayMatch = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b`, "i").exec(request.toLowerCase());
  if (weekdayMatch) {
    planDate = resolveWeekday(WEEKDAYS.indexOf(weekdayMatch[1] as (typeof WEEKDAYS)[number]), referenceDate);
    dateExplicit = true;
  } else if (/\bthis weekend\b/i.test(request)) {
    planDate = resolveWeekday(6, referenceDate);
    dateExplicit = true;
  } else if (/\btomorrow\b/i.test(request)) {
    planDate = addDays(referenceDate, 1);
    dateExplicit = true;
  } else if (/\b(today|tonight)\b/i.test(request)) {
    planDate = referenceDate;
    dateExplicit = true;
  }
  if (!dateExplicit) {
    assumptions.push(
      `No date mentioned — everything is scheduled on ${prettyDate(planDate)} (today).`,
    );
  }

  const people = parsePeopleCount(request);
  if (people) {
    assumptions.push(`"For ${people === 2 ? "two" : people}" — portions and workload estimated for ${people} people.`);
  }

  let clarification: string | null = null;
  let planningTitle = "Household plan";
  let cleanedSomething = false;
  let shoppedSomething = false;
  let remindedSomething = false;

  for (const clause of clauses) {
    /* ---------------------------- grocery clauses --------------------------- */
    const wantsGroceries =
      /\b(grocer(y|ies)?|shopping (list|trip)|buy|pick up|restock|we need|we'?re out of|add .{0,30}(rice|milk|eggs|bread|pasta|chicken|cheese))\b/i.test(
        clause,
      ) || findCatalogItems(clause).length > 0;

    if (wantsGroceries) {
      const meal = mealFrom(clause);
      const explicitItems = findCatalogItems(clause);
      const items: CatalogItem[] =
        explicitItems.length > 0
          ? explicitItems
          : meal
            ? (MEAL_SETS[meal] ?? []).map((name) => CATALOG.find((item) => item.name === name)!).filter(Boolean)
            : STAPLES.map((name) => CATALOG.find((item) => item.name === name)!).filter(Boolean);

      if (items.length > 0) {
        shoppedSomething = true;
        const reason = meal
          ? `for ${meal}`
          : explicitItems.length > 0
            ? people
              ? `for ${people} people`
              : "as requested"
            : people
              ? `staples for ${people} people`
              : "weekly staples";
        for (const item of items) {
          actions.push({
            tool: "add_grocery_item",
            args: {
              name: item.name,
              quantity: item.quantity,
              unit: item.unit,
              category: item.category,
              notes: `Planned ${reason} · ${prettyDate(planDate)}`,
            },
            label: `Add ${item.name} (${item.quantity} ${item.unit})`,
            detail: `${item.category} · planned ${reason}`,
          });
        }
        if (meal && explicitItems.length === 0) {
          assumptions.push(
            `Groceries for ${meal} expanded to a standard ${meal} set (vegetarian-friendly, matches household preferences).`,
          );
        }
        if (!meal && explicitItems.length === 0) {
          assumptions.push(
            "Grocery items were not named, so a staple basket was suggested — remove anything you do not need.",
          );
        }
        if (!meal && !people && explicitItems.length > 0) {
          notes.push("Grocery items were inferred from the wording of your request.");
        }
      } else if (/\bgrocer|shopping/i.test(clause)) {
        clarification ??= `Which groceries do you need? Add a few items (e.g. "rice, spinach, oat milk") and I'll stage them.`;
      }
    }

    /* --------------------------- cleaning clauses --------------------------- */
    if (/\b(clean|cleaning|vacuum|tidy|mop|dust|scrub|wipe|declutter)\b/i.test(clause)) {
      cleanedSomething = true;
      const timeHint = parseClockTime(clause);
      const startMinutes = timeHint ? timeHint.minutes : 14 * 60;
      const endMinutes = startMinutes + 90;
      const start = minutesToTime(startMinutes);
      const end = minutesToTime(endMinutes);
      const roomMatch = /\b(living room|kitchen|bathroom|bedrooms?|windows|garage|garden|whole house|dining room)\b/i.exec(
        clause,
      );
      const scope = roomMatch ? roomMatch[1].toLowerCase() : "living room and kitchen";
      if (!timeHint) {
        assumptions.push(`No time given for cleaning — assumed afternoon (${prettyTime(start)}–${prettyTime(end)}).`);
      }

      actions.push({
        tool: "create_schedule_event",
        args: {
          title: "Cleaning session",
          date: planDate,
          start_time: start,
          end_time: end,
          location: "Home",
          notes: `Focus: ${scope}`,
        },
        label: `Schedule cleaning session (${prettyTime(start)}–${prettyTime(end)})`,
        detail: `Focus: ${scope}`,
      });
      actions.push({
        tool: "create_task",
        args: {
          title: `Clean ${scope}`,
          due_date: planDate,
          due_time: start,
          category: "Cleaning",
          priority: "medium",
          notes: "Created from a household plan.",
        },
        label: `Task: Clean ${scope}`,
        detail: `Due ${prettyDate(planDate)} at ${prettyTime(start)}`,
      });
      if (!timeHint && !clarification) {
        clarification = "What time should the cleaning session start? I assumed the afternoon.";
      }
    }

    /* --------------------------- reminder clauses --------------------------- */
    const reminderMatch = /\bremind (?:me |us )?(?:to |about )?(.+)$/i.exec(clause);
    if (reminderMatch || /\bbefore\b/i.test(clause)) {
      const subject = (reminderMatch?.[1] ?? clause)
        .replace(/\bbefore\b.*$/i, "")
        .replace(/^(to|about)\s+/i, "")
        .trim();
      if (subject.length > 3 && !/\b(clean|cleaning|vacuum|tidy)\b/i.test(subject)) {
        const timeHint = parseClockTime(clause);
        let dueMinutes: number;
        if (timeHint) {
          dueMinutes = Math.max(0, timeHint.minutes - 30);
          if (!/\bbefore\b/i.test(clause)) dueMinutes = timeHint.minutes;
          assumptions.push(
            /\bbefore\b/i.test(clause)
              ? `Reminder "${subject}" set 30 minutes before ${prettyTime(minutesToTime(timeHint.minutes))} (buffer time).`
              : `Reminder "${subject}" set for ${prettyTime(minutesToTime(timeHint.minutes))}.`,
          );
        } else {
          dueMinutes = 18 * 60 + 30;
          clarification ??= "What time should the reminder fire? I assumed 6:30 PM.";
        }
        remindedSomething = true;
        actions.push({
          tool: "create_task",
          args: {
            title: subject.charAt(0).toUpperCase() + subject.slice(1),
            due_date: planDate,
            due_time: minutesToTime(dueMinutes),
            category: "Reminder",
            priority: "high",
            notes: "Created from a household plan.",
          },
          label: `Reminder: ${subject.charAt(0).toUpperCase() + subject.slice(1)}`,
          detail: `Due ${prettyDate(planDate)} at ${prettyTime(minutesToTime(dueMinutes))}`,
        });
      }
    }

    /* ---------------------------- schedule clauses -------------------------- */
    const scheduleMatch =
      /\b(schedule|book|invite|guests?|dinner party|appointment|pickup|practice|party|drop off|collect)\b/i.test(
        clause,
      ) && !cleanedSomething;
    if (scheduleMatch && !/\bremind\b/i.test(clause)) {
      const timeHint = parseClockTime(clause);
      const title = clause
        .replace(/^\s*(?:please\s+)?(?:schedule|book|plan|organize)\s+/i, "")
        .replace(/\s+(on|at|before|in the)\b.*$/i, "")
        .trim();
      const label = title.length > 2 ? title.charAt(0).toUpperCase() + title.slice(1) : "Scheduled event";
      const start = minutesToTime(timeHint ? timeHint.minutes : 18 * 60);
      const end = minutesToTime((timeHint ? timeHint.minutes : 18 * 60) + 60);
      if (!timeHint) {
        assumptions.push(`No time given for "${label}" — assumed ${prettyTime(start)}–${prettyTime(end)}.`);
      }
      planningTitle = label;
      actions.push({
        tool: "create_schedule_event",
        args: {
          title: label,
          date: planDate,
          start_time: start,
          end_time: end,
          location: null,
          notes: "Created from a household plan.",
        },
        label: `Schedule: ${label} (${prettyTime(start)}–${prettyTime(end)})`,
        detail: prettyDate(planDate),
      });
    }
  }

  /* ------------------------- generic fallback action ----------------------- */
  if (actions.length === 0) {
    const generic = clauses[0] ?? request.trim();
    const title = generic.charAt(0).toUpperCase() + generic.slice(1);
    actions.push({
      tool: "create_task",
      args: {
        title: title.length > 200 ? `${title.slice(0, 197)}…` : title,
        due_date: planDate,
        category: "Household",
        priority: "medium",
        notes: "Created from a household plan — no structured pattern matched.",
      },
      label: `Task: ${title}`,
      detail: `Due ${prettyDate(planDate)}`,
    });
    assumptions.push(
      "The request did not match a structured pattern, so it was captured as a single task for you to review.",
    );
  }

  /* -------------------------------- summary -------------------------------- */
  const bits: string[] = [];
  if (shoppedSomething) bits.push("grocery items staged");
  if (cleanedSomething) bits.push("a cleaning session scheduled");
  if (remindedSomething) bits.push("a timed reminder added");
  const extraTasks = actions.filter(
    (action) => action.tool === "create_task" && !actions.some((a) => a === action),
  ).length;
  void extraTasks;

  const title = planningTitle !== "Household plan" ? planningTitle : `Plan for ${prettyDate(planDate)}`;
  const summary =
    bits.length > 0
      ? `Prepared ${bits.join(", ")} for ${prettyDate(planDate)} (${actions.length} action${actions.length === 1 ? "" : "s"}). Review each action below — nothing is applied until you approve.`
      : `Prepared ${actions.length} action${actions.length === 1 ? "" : "s"} for ${prettyDate(planDate)}. Review each action below — nothing is applied until you approve.`;

  if (notes.length) assumptions.push(...notes);

  return { title, summary, assumptions: Array.from(new Set(assumptions)), clarification, actions };
}
