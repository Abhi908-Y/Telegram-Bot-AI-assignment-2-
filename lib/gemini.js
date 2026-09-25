// Calls the Gemini API. Prompts live in /prompts so you can edit
// Meera's voice without touching code.

import { readFileSync } from "fs";
import path from "path";
import { searchNews } from "./news.js";

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
// Vercel stops the function at 300s. Each step gets its own time budget so the
// whole chain (triage 45s + news 15s + draft 140s + fact-check 80s) fits, and
// Meera still gets a message instead of silence.
const BUDGET = { triage: 45_000, draft: 140_000, check: 80_000 };
const RETRYABLE = new Set([429, 500, 503]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(system, user, { json = false, budgetMs = BUDGET.draft, temperature } = {}) {
  const primary = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  const models = [primary, ...BACKUP_MODELS.filter((m) => m !== primary)];
  let lastError;
  const deadline = Date.now() + budgetMs;

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 10_000) {
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
                temperature: temperature ?? (json ? 0.2 : 0.6),
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
  const text = await ask(readPrompt("triage.txt"), `Raw note:\n${note}`, { json: true, budgetMs: BUDGET.triage });
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    // If the model returns something unparseable, fail safe: let Meera decide.
    return { decision: "park", score: 0, reason: "Triage could not be read; use Draft anyway if you want this one.", category: "", core_point: "", moment: "", numbers: "", missing: "" };
  }
}

const NEWS_RULES = `
====================================================================
NEWS CONTEXT RULES
====================================================================
The brief may include NEWS CONTEXT: real Google News results (headline, publisher, date) numbered S1, S2, ... You only see headlines, not the articles.

- Use news only for general, public claims (industry practice, regulation, ingredient science, market trends). Never as evidence for anything about Skinstinct, Meera, her suppliers or her customers - only the brief can supply those.
- Only rely on what a headline actually says. Do not assume details of an article you have not read.
- Do not put links, source names or [S1] markers in the post itself. It must stay a clean LinkedIn post.
- In CLAIMS TO VERIFY, after each claim a headline directly supports, add its id in brackets, e.g. "(supported by S2)". If no headline supports a claim, add "(no news source found)".
- If you used news to add a general point, it must be marked in CLAIMS TO VERIFY with its source id.
- Do NOT write a sources or references section. The system adds SOURCES USED automatically.
- If none of the headlines are relevant, ignore them completely.
`;

function newsBlock(articles) {
  if (!articles.length) return "\n\nNEWS CONTEXT: no Google News results were found for this note.";
  const lines = articles.map((a) => `${a.id}: "${a.title}" - ${a.source}${a.date ? `, ${a.date}` : ""}`);
  return `\n\nNEWS CONTEXT (Google News RSS headlines):\n${lines.join("\n")}`;
}

// Built in code from real search results, so the model can never invent a link.
function sourcesSection(output, articles) {
  const used = articles.filter((a) => new RegExp(`\\b${a.id}\\b`).test(output));
  const fmt = (a) => `${a.id}. ${a.title} - ${a.source}${a.date ? ` (${a.date})` : ""}\n${a.link}`;
  if (used.length) return `SOURCES USED\n\n${used.map(fmt).join("\n\n")}`;
  if (!articles.length) return "SOURCES USED\n\nNone. Google News returned no results for this note, so nothing here is news-verified.";
  return `SOURCES USED\n\nNone. No news headline directly supported a claim in this draft. Related coverage, for context only:\n\n${articles.slice(0, 3).map(fmt).join("\n\n")}`;
}

// Step 2: draft in Meera's voice. Optional feedback/previous draft for redrafts.
export async function draft(note, t = {}, feedback = "", previousDraft = "") {
  const queries = t.search_queries?.length ? t.search_queries : [t.core_point || note.slice(0, 80)];
  const articles = await searchNews(queries);

  let brief = `Raw note: ${note}
Core point: ${t.core_point || ""}
Category: ${t.category || ""}
The moment: ${t.moment || ""}
Numbers I can use: ${t.numbers || ""}
Skinstinct angle (optional):
Avoid (optional):`;
  brief += newsBlock(articles);

  if (feedback) {
    brief += `\n\nThis is a REDRAFT. Meera's feedback on the previous version:\n${feedback}`;
    if (previousDraft) brief += `\n\nPrevious version:\n${previousDraft}`;
  }
  const voice = readPrompt("meera_voice.txt");
  const firstDraft = cleanOutput(
    await ask(voice + "\n" + DRAFT_RULES + "\n" + NEWS_RULES, brief, { budgetMs: BUDGET.draft })
  );
  const output = await factCheck(firstDraft, note, voice, articles);
  return `${output}\n\n${sourcesSection(output, articles)}`;
}

// Drop any sources list the model wrote anyway; SOURCES USED is built in code.
const cleanOutput = (text) => stripMarkdown(text).replace(/\n+SOURCES USED[\s\S]*$/i, "");

const CHECK_SYSTEM = `You are a strict fact-checker for LinkedIn drafts written for Meera Pillai, founder of Skinstinct. You do not write or improve posts. You remove what cannot be supported.

You receive: the NOTE (Meera's own words, the only source for anything about her, Skinstinct, its batches, suppliers, customers, timings and quantities), the REFERENCE (her voice guide, whose Data Bank lists figures she has already published), NEWS headlines (S1, S2, ... - headlines only, not articles), and the DRAFT.

Go through the DRAFT sentence by sentence, including the hook options:
1. Any statement about Meera, Skinstinct, its products, batches, tests, suppliers, customers, history, counts, timings or plans that is not stated in the NOTE or the Data Bank: delete it, or replace the specific detail with a [DATA: ...] placeholder. Do not keep it just because it sounds plausible. This includes invented safety tests, batch counts, company age claims used as new facts, delays, and time words like "last week".
2. A number derived by arithmetic from the NOTE or Data Bank may stay only if it is listed under CLAIMS TO VERIFY.
3. A "(supported by S#)" tag is allowed only if that headline itself directly states the claim. News can never support a claim about Skinstinct or Meera. Remove wrong tags and write "(no news source found)" instead.
4. CLAIMS TO VERIFY must list every remaining factual or scientific claim not taken word-for-word from the NOTE.
5. Keep everything else exactly as written: same voice, same structure, same section labels. Make the smallest edits possible.

Output the corrected draft in plain text, no markdown, same sections as the DRAFT, then add a final section:
FACT-CHECK
One line per change: what you removed or replaced, and why. If nothing needed changing, write "No changes needed."
Do not add a sources section.`;

// Second pass: strip anything the first draft can't back up. If Gemini is too
// busy, send the unchecked draft with a clear warning rather than nothing.
async function factCheck(draftText, note, voice, articles) {
  const input = `NOTE:\n${note}\n\nREFERENCE:\n${voice}${newsBlock(articles)}\n\nDRAFT:\n${draftText}`;
  try {
    const checked = cleanOutput(await ask(CHECK_SYSTEM, input, { budgetMs: BUDGET.check, temperature: 0 }));
    // Weaker backup models sometimes drop sections; never trade CLAIMS TO VERIFY for a "checked" label.
    const lost = ["HOOK OPTIONS", "THE POST", "CLAIMS TO VERIFY"].filter(
      (s) => draftText.includes(s) && !checked.includes(s)
    );
    if (lost.length) throw new Error(`fact-check dropped ${lost.join(", ")}`);
    return checked;
  } catch (err) {
    console.warn("Fact-check skipped:", err.message);
    return `${draftText}\n\nFACT-CHECK\nNot run (${err.message.slice(0, 80)}). This draft has NOT been fact-checked - review every claim carefully.`;
  }
}
