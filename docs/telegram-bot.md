# Jazz Telegram

The Jazz dashboard includes a Telegram-only panel that talks to Telegram through an authorized **user MTProto session**. It is isolated from normal Jazz chat, Ollama, Android scripts and `/api/chat`.

## What it does

Open **Quick Actions → Telegram**, select `Karnacam_bot`, and Jazz first shows the Telegram-style **START** bar. START sends the real `/start` message from your Telegram account. After that, the panel loads the real conversation and displays Telegram content dynamically instead of hardcoded bot responses.

Supported presentation and actions include:

- text messages and timestamps
- incoming/outgoing bubbles
- photos and videos
- downloadable files/documents
- Telegram locations with an interactive map/open-map link
- link-preview metadata
- forwarded-message labels
- reply keyboards
- inline callback buttons and URL buttons
- live conversation updates through the local Telegram event stream

Messages typed in the Jazz Telegram composer are sent through the authorized Telegram user account. Inline callback buttons are executed against the real Telegram message/callback data.

## Secure local configuration

Put private values only in `services/api/.env` on your PC:

```env
JAZZ_TELEGRAM_BOT_USERNAME=Karnacam_bot
JAZZ_TELEGRAM_BOT_TOKEN=OPTIONAL_BOTFATHER_TOKEN
JAZZ_TELEGRAM_API_ID=YOUR_API_ID
JAZZ_TELEGRAM_API_HASH=YOUR_API_HASH
JAZZ_TELEGRAM_SESSION=YOUR_PRIVATE_STRING_SESSION
JAZZ_TELEGRAM_HISTORY_LIMIT=150
```

`JAZZ_TELEGRAM_BOT_TOKEN` is optional for the MTProto conversation; it is useful for resolving/verifying the bot identity. The API ID, API hash and StringSession are required for sending and reading messages as your Telegram user account.

Never commit the real token, API hash or session string. The browser receives only connection state, bot identity and message data; it does not receive the private session credentials.

## Create the Telegram user session

From the repository root, run:

```powershell
pnpm --filter @jazz/web telegram:login
```

Sign in to your own Telegram account when prompted. Save the generated StringSession into `JAZZ_TELEGRAM_SESSION` in `services/api/.env`, then restart Jazz.

## Runtime routes

Telegram is handled only under `/telegram-api/*` by the local web backend. Important routes are:

- `GET /telegram-api/status`
- `GET /telegram-api/messages`
- `GET /telegram-api/events` — live message stream
- `GET /telegram-api/media/:messageId`
- `POST /telegram-api/start`
- `POST /telegram-api/send`
- `POST /telegram-api/callback`

Normal Jazz requests remain on `/api/*`; Telegram does not replace the Jazz API or script router.
