// Calls the Claude Messages API. Prompts live in /prompts so you can edit
// Meera's voice without touching code.

import { readFileSync } from "fs";
import path from "path";

const readPrompt = (name) =>
  readFileSync(path.join(process.cwd(), "prompts", name), "utf8");

async function ask(system, user, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API error: ${JSON.stringify(data.error || data)}`);
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// Step 1: triage. Returns an object like { decision, score, reason, ... }.
export async function triage(note) {
  const text = await ask(readPrompt("triage.txt"), `Raw note:\n${note}`, 600);
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
  return ask(readPrompt("meera_voice.txt"), brief, 3000);
}
