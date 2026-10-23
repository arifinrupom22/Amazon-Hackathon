import { describe, expect, it } from "vitest";
import {
  SPOKEN_ERROR_TEXT,
  shouldSpeakResponse,
  spokenErrorMessage,
  spokenPlanText,
} from "./speechText.js";

describe("spoken plan copy", () => {
  it("summarizes the plan, action count and question", () => {
    const text = spokenPlanText({
      summary: "A relaxed Saturday with groceries and cleaning.",
      actionCount: 3,
      clarification: "Which store should I use?",
    });
    expect(text).toContain("A relaxed Saturday");
    expect(text).toContain("3 actions");
    expect(text).toContain("Nothing has been applied yet.");
    expect(text).toContain("One question: Which store");
  });

  it("uses the singular form for one action", () => {
    expect(spokenPlanText({ summary: "One thing to do.", actionCount: 1 })).toContain("1 action");
  });

  it("never speaks the quota notice or provider diagnostics", () => {
    const text = spokenPlanText({
      summary: "Groceries are staged for Saturday.",
      actionCount: 2,
    });
    expect(text).not.toContain("API credits exhausted");
    expect(text).not.toContain("Demo mode");
    expect(text).not.toMatch(/GEMINI|HTTP|429/);
    expect(text).toContain("2 actions");
  });
});

describe("spoken error copy", () => {
  it("is calm, actionable and free of internals", () => {
    expect(spokenErrorMessage()).toBe(SPOKEN_ERROR_TEXT);
    expect(SPOKEN_ERROR_TEXT).not.toMatch(/429|HTTP|GEMINI|stack|token/i);
    expect(SPOKEN_ERROR_TEXT).toMatch(/try again/i);
  });
});

describe("auto-speak rules", () => {
  const base = {
    mounted: true,
    autoSpeak: true,
    role: "assistant" as const,
    messageId: "m_2",
    lastSpokenId: null,
  };

  it("speaks a new assistant message when enabled", () => {
    expect(shouldSpeakResponse(base)).toBe(true);
  });

  it("does not speak restored history, user messages or duplicates", () => {
    expect(shouldSpeakResponse({ ...base, mounted: false })).toBe(false);
    expect(shouldSpeakResponse({ ...base, autoSpeak: false })).toBe(false);
    expect(shouldSpeakResponse({ ...base, role: "user" })).toBe(false);
    expect(shouldSpeakResponse({ ...base, lastSpokenId: "m_2" })).toBe(false);
    expect(shouldSpeakResponse({ ...base, messageId: null })).toBe(false);
  });
});
