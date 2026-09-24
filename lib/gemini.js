// Calls the Gemini API. Prompts live in /prompts so you can edit
// Meera's voice without touching code.

import { readFileSync } from "fs";
import path from "path";

const readPrompt = (name) =>
  readFileSync(path.join(process.cwd(), "prompts", name), "utf8");

// Added after meera_voice.txt. The voice file stays the authority on content and style.
const DRAFT_RULES = `
====================================================================
TELEGRAM OUTPUT AND ACCURACY NOTES
====================================================================
These add to everything above. Where they touch content, voice or accuracy, the sections above win.

- Reply in plain text only. No markdown at all: no asterisks, no # headers, no *** dividers. Label each part of your output in plain capitals on its own line, e.g. HOOK OPTIONS.
- The accuracy rules apply to EVERY part of the output, including all three hook options, not just the post. If a hook type needs a number or moment the brief doesn't give, write that hook with a [DATA: ...] or [STORY: ...] placeholder instead of inventing one.
- Never add time words the brief doesn't give ("last week", "yesterday", "last month"). If timing matters, use [DATA: when did this happen?].
- Every number that is not in the brief or the Data Bank must be removed or listed under CLAIMS TO VERIFY. Invented Skinstinct figures are never allowed. A made-up number next to a placeholder is still made up: if any part of a figure is unknown, the whole figure is a placeholder.
- Statements about Skinstinct - what it makes, doesn't make, sells, tests, publishes, decided, or why - must come from the brief or the Data Bank. Do not infer company practices from general chemistry, however logical. If the post needs one, write [DATA: does Skinstinct ...?].
- Before replying, reread every sentence that mentions Skinstinct, "we" or "our", and every number, and delete or placeholder anything you cannot point to in the brief or the Data Bank.
`;

// Free-tier models are often overloaded (503), rate-limited (429) or slow:
// retry each, then move down the list.
const BACKUP_MODELS = ["gemini-flash-latest", "gemini-3.1-flash-lite"];
// Vercel stops the function at 300s. Stop retrying well before that so Meera
// still gets an error message instead of silence.
const TIME_BUDGET_MS = 200_000;
const RETRYABLE = new Set([429, 500, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(system, user, { json = false } = {}) {
  const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const models = [primary, ...BACKUP_MODELS.filter((m) => m !== primary)];
  let lastError;
  const deadline = Date.now() + TIME_BUDGET_MS;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 15_000) {
        throw new Error(`Gemini is busy right now (${lastError?.message || "timed out"}). Please try again in a few minutes.`);
      }
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: user }] }],
              generationConfig: {
                temperature: json ? 0.2 : 0.6,
                ...(json && { responseMimeType: "application/json" }),
              },
            }),
            signal: AbortSignal.timeout(Math.min(90_000, remaining)),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          lastError = new Error(`Gemini API error (${model}): ${data.error?.message || res.status}`);
          if (!RETRYABLE.has(res.status)) break; // e.g. unknown model: try the next one
        } else {
          const text = (data.candidates?.[0]?.content?.parts || [])
            .filter((p) => !p.thought)
            .map((p) => p.text || "")
            .join("")
            .trim();
          if (text) return text;
          lastError = new Error(`Gemini returned an empty response (${model})`);
        }
      } catch (err) {
        lastError = err; // network error or timeout
      }
      console.warn(`${model} attempt ${attempt} failed: ${lastError.message}`);
      await sleep(attempt * 3000);
    }
  }
  throw lastError;
}

// Safety net in case the model still uses markdown: LinkedIn shows it as literal symbols.
function stripMarkdown(text) {
  return text
    .replace(/^\s*(\*{3,}|-{3,}|_{3,})\s*$/gm, "") // *** / --- dividers
    .replace(/^#{1,6}\s*/gm, "") // # headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Step 1: triage. Returns an object like { decision, score, reason, ... }.
export async function triage(note) {
  const text = await ask(readPrompt("triage.txt"), `Raw note:\n${note}`, { json: true });
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // If the model returns something unparseable, fail safe: let Meera decide.
    return { decision: "park", score: 0, reason: "Triage could not be read; use Draft anyway if you want this one.", category: "", core_point: "", moment: "", numbers: "", missing: "" };
  }
}

// Step 2: draft in Meera's voice. Optional feedback/previous draft for redrafts.
export async function draft(note, t = {}, feedback = "", previousDraft = "") {
  let brief = `Raw note: ${note}
Core point: ${t.core_point || ""}
Category: ${t.category || ""}
The moment: ${t.moment || ""}
Numbers I can use: ${t.numbers || ""}
Skinstinct angle (optional):
Avoid (optional):`;

  if (feedback) {
    brief += `\n\nThis is a REDRAFT. Meera's feedback on the previous version:\n${feedback}`;
    if (previousDraft) brief += `\n\nPrevious version:\n${previousDraft}`;
  }
  return stripMarkdown(await ask(readPrompt("meera_voice.txt") + "\n" + DRAFT_RULES, brief));
}
