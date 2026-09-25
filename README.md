# Meera's Content Bot

Note posted in Telegram channel → Gemini triages it → Google News RSS is searched for related coverage → Gemini drafts a LinkedIn post in Meera's voice → a second Gemini pass fact-checks the draft → draft arrives in Meera's Telegram DM with Approve / Redraft / Kill buttons.

Nothing is ever posted to LinkedIn automatically. Meera reviews, verifies flagged claims, and publishes herself.

## Files

```
api/telegram.js        The webhook: receives Telegram updates and routes them
lib/gemini.js          Calls the Gemini API (triage + drafting), with retries and backup models
lib/news.js            Searches Google News RSS (free, no API key)
lib/telegram.js        Sends messages and handles buttons
prompts/triage.txt     Decides develop vs park
prompts/meera_voice.txt  Meera's voice (edit this to tune the writing)
vercel.json            300-second time limit; bundles the prompts folder
package.json
```

## Setup

### 1. Get a Gemini API key
Sign in at https://aistudio.google.com/apikey and click Create API key. The free tier works; free models are sometimes busy, so the bot retries and falls back to backup models automatically.

### 2. Replace the files on GitHub
Upload this whole folder to your `meera-bot` repo, replacing the old `api/telegram.js` and `package.json`. Keep the folder structure exactly as above.

### 3. Add environment variables in Vercel
Project → Settings → Environment Variables:

| Name | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | already set |
| `TELEGRAM_WEBHOOK_SECRET` | already set |
| `GEMINI_API_KEY` | your Gemini API key |
| `GEMINI_MODEL` | optional; defaults to `gemini-3.5-flash` |
| `MEERA_CHAT_ID` | added in step 5 |
| `NOTES_CHANNEL_ID` | optional; added in step 6 |

Then Deployments → ⋯ → Redeploy.

### 4. Re-run the webhook handshake
Buttons need `callback_query` updates, which the earlier handshake didn't include. Open this in your browser:

```
https://api.telegram.org/botYOUR_TOKEN/setWebhook?url=https://YOUR-PROJECT.vercel.app/api/telegram&secret_token=YOUR_SECRET&allowed_updates=["channel_post","message","callback_query"]
```

### 5. Get Meera's chat ID
Meera (or you, while testing) opens a direct chat with the bot and sends `/start`. The bot replies with a chat ID. Add it as `MEERA_CHAT_ID` in Vercel and redeploy.

A bot can only message people who have sent it `/start` first.

### 6. Lock it to her notes channel (recommended)
Post anything in the channel, then open Vercel → Logs. You'll see `Channel post from chat id: -100…`. Add that number as `NOTES_CHANNEL_ID` and redeploy. After this, posts from any other channel the bot is in are ignored.

### 7. Test
Post a real note in the channel. Within about 2–4 minutes, Meera's DM receives either:
- **DRAFT**: score, category, three hook options, the post, claims to verify (each tagged with a news source or "no news source found"), a FACT-CHECK list of what was removed, and SOURCES USED with article links, with buttons ✅ Approve / 🔁 Redraft / 🗑 Kill
- **PARKED**: why it isn't strong enough, what would fix it, with buttons ✍️ Draft anyway / 🗑 Dismiss

## How Meera uses it

- **Approve**: she copies the post, checks the flagged claims, fills any [DATA] / [STORY] / [HOOK] slots, and publishes.
- **Redraft**: a fresh version with a different hook and structure.
- **Specific changes**: she *replies* to the draft message (the one with the buttons) with instructions, e.g. "shorter, and open with the trade fair". The bot redrafts with her changes.
- **Kill**: gone.
- She can also send a note straight to the bot's DM instead of the channel. It's treated the same way.

## Guardrails

- **News sources.** The triage step picks 2-3 search phrases for the general topics in a note. The bot searches Google News RSS (India edition) and gives the headlines to Gemini as context. Gemini may only use them for general claims (industry, regulation, science), never as proof of anything about Skinstinct or Meera.
- **SOURCES USED is built in code**, from articles Google News actually returned. The model cannot invent a link. If no headline supports a claim, the section says so and lists related coverage "for context only".
- **Fact-check pass.** A second Gemini call compares the draft sentence by sentence against the note, the voice guide's Data Bank and the headlines, removes or placeholders anything unsupported, and lists its changes under FACT-CHECK.
- **Fail-safe.** If Gemini is too busy for the fact-check, or the check drops a section, Meera gets the original draft with a clear "NOT been fact-checked" warning.
- **Limits.** RSS gives headlines only, not article text, so it shows a topic is covered, not that a specific number is correct. Meera's private details (batches, suppliers, returns) can only be confirmed by her. The fact-check is much stricter than the draft step but not perfect; she still reviews every claim.

## Tuning

- To change the writing, edit `prompts/meera_voice.txt` and redeploy. No code changes needed.
- To make triage stricter or looser, edit `prompts/triage.txt`.
- Troubleshooting: Vercel → Logs shows every note received and every error. Errors are also sent to Meera's DM.

## Known limits (deliberate, for now)

- No database. Each message carries its note in the header, which is what lets the buttons work. The trade-off is no history of approved or killed drafts.
- No auto-posting to LinkedIn (Boundary check 07: Meera stays the publisher).
- No auto-sourced news angle (the Cut, from Boundary check 06): drafts leave a [HOOK] slot instead.
- The 60 backlog notes aren't processed automatically. Paste them into the channel a few at a time to run them through.
