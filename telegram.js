// Meera's content bot.
// Flow: note posted in her Telegram channel -> triage -> draft in her voice
// -> draft sent to her DM with Approve / Redraft / Kill buttons.
// Nothing is ever posted to LinkedIn automatically. Meera publishes herself.

import { waitUntil } from "@vercel/functions";
import { triage, draft } from "../lib/claude.js";
import { sendText, answerCallback, removeButtons } from "../lib/telegram.js";

const MEERA = () => process.env.MEERA_CHAT_ID;
const DIVIDER = "━━━━━━━━━━━━";

// Every message carries the note in a header so buttons can work without a database.
const header = (label, note) => `${label}\nNOTE: ${note}\n${DIVIDER}`;
const noteFrom = (text = "") => {
  const m = text.match(/NOTE: ([\s\S]*?)\n━━━━━━━━━━━━/);
  return m ? m[1].trim() : null;
};

const DRAFT_BUTTONS = [[
  { text: "✅ Approve", callback_data: "approve" },
  { text: "🔁 Redraft", callback_data: "redraft" },
  { text: "🗑 Kill", callback_data: "kill" },
]];
const PARKED_BUTTONS = [[
  { text: "✍️ Draft anyway", callback_data: "draft" },
  { text: "🗑 Dismiss", callback_data: "kill" },
]];

async function sendDraft(note, t, feedback = "", previous = "", label = "DRAFT") {
  const output = await draft(note, t, feedback, previous);
  await sendText(MEERA(), `${header(label, note)}\n${output}`, DRAFT_BUTTONS);
}

// A new note arrived in the channel.
async function handleNote(note) {
  const t = await triage(note);
  if (t.decision === "develop") {
    await sendDraft(note, t, "", "", `DRAFT · score ${t.score}/10 · ${t.category}`);
  } else {
    const missing = t.missing ? `\nTo make it work: ${t.missing}` : "";
    await sendText(MEERA(), `${header("PARKED", note)}\n${t.reason}${missing}`, PARKED_BUTTONS);
  }
}

// Meera pressed a button.
async function handleButton(q) {
  const msg = q.message;
  const note = noteFrom(msg.text);
  await answerCallback(q.id, "On it");
  await removeButtons(msg.chat.id, msg.message_id);

  if (q.data === "approve") {
    return sendText(MEERA(), "Approved. Copy the post above, verify the flagged claims, and publish on LinkedIn.");
  }
  if (q.data === "kill") {
    return sendText(MEERA(), "Killed. It won't come back.");
  }
  if (!note) {
    return sendText(MEERA(), "I couldn't find the original note on that message.");
  }
  if (q.data === "draft") {
    return sendDraft(note, await triage(note), "", "", "DRAFT (on your request)");
  }
  if (q.data === "redraft") {
    return sendDraft(note, await triage(note), "Write a different version: try another hook type and a different structure.", msg.text, "REDRAFT");
  }
}

// Meera replied to a draft with instructions, e.g. "shorter, open with the trade fair".
async function handleFeedback(message) {
  const replied = message.reply_to_message;
  const note = noteFrom(replied.text);
  if (!note) {
    return sendText(MEERA(), "Reply to the draft message that has the buttons, and I'll redraft it with your changes.");
  }
  await sendDraft(note, await triage(note), message.text, replied.text, "REDRAFT (with your changes)");
}

async function route(update) {
  // 1. A note posted in her notes channel.
  if (update.channel_post?.text) {
    const channelId = String(update.channel_post.chat.id);
    console.log("Channel post from chat id:", channelId);
    const allowed = process.env.NOTES_CHANNEL_ID;
    if (allowed && channelId !== allowed) return;
    if (!MEERA()) return console.log("MEERA_CHAT_ID not set yet. Message the bot /start first.");
    return handleNote(update.channel_post.text);
  }

  // 2. A button press. Only Meera can press buttons.
  if (update.callback_query) {
    if (String(update.callback_query.from.id) !== MEERA()) return;
    return handleButton(update.callback_query);
  }

  // 3. A direct message to the bot.
  const m = update.message;
  if (!m?.text) return;
  if (m.text.startsWith("/start")) {
    // Shows the chat id you need for MEERA_CHAT_ID.
    return sendText(m.chat.id, `Hi. Your chat ID is ${m.chat.id}\nAdd it to Vercel as MEERA_CHAT_ID, then redeploy.`);
  }
  if (String(m.chat.id) !== MEERA()) return;
  if (m.reply_to_message) return handleFeedback(m);
  // Anything else she sends the bot directly is treated as a note too.
  return handleNote(m.text);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Meera bot webhook is live.");

  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  // Answer Telegram immediately (so it doesn't retry and create duplicate drafts),
  // then keep working in the background while Claude writes the draft.
  waitUntil(
    route(req.body || {}).catch(async (err) => {
      console.error(err);
      if (MEERA()) await sendText(MEERA(), `Something went wrong while processing a note: ${err.message}`);
    })
  );
  return res.status(200).send("ok");
}
