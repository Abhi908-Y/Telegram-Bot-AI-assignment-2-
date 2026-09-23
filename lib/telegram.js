// Small helpers for the Telegram Bot API.

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const LIMIT = 4000; // Telegram's hard limit is 4096 characters per message.

async function call(method, payload) {
  const res = await fetch(`${API()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) console.error(`Telegram ${method} failed:`, data.description);
  return data;
}

// Split long text on paragraph breaks so no message exceeds the limit.
function chunk(text) {
  const parts = [];
  let current = "";
  for (const para of text.split("\n\n")) {
    const next = current ? `${current}\n\n${para}` : para;
    if (next.length > LIMIT && current) {
      parts.push(current);
      current = para;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.map((p) => (p.length > LIMIT ? p.slice(0, LIMIT) : p));
}

// Send text (split if needed). Buttons go on the FIRST message, which also
// carries the NOTE header, so button presses can recover the original note.
export async function sendText(chatId, text, buttons) {
  const parts = chunk(text);
  for (let i = 0; i < parts.length; i++) {
    const payload = { chat_id: chatId, text: parts[i], disable_web_page_preview: true };
    if (i === 0 && buttons) payload.reply_markup = { inline_keyboard: buttons };
    await call("sendMessage", payload);
  }
}

export const answerCallback = (id, text) =>
  call("answerCallbackQuery", { callback_query_id: id, text });

export const removeButtons = (chatId, messageId) =>
  call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
