# Jazz Telegram Bot

Jazz can use one configured Telegram bot directly from the dashboard.

## Configure

Create the bot with BotFather, then add these two variables to your local file:

`services/api/.env`

```env
JAZZ_TELEGRAM_BOT_TOKEN=YOUR_BOTFATHER_TOKEN
JAZZ_TELEGRAM_CHAT_ID=YOUR_TELEGRAM_CHAT_ID
```

Do not commit the real token. The repository `.gitignore` excludes local `.env` files.

For a private chat, open the bot in Telegram and press **Start** once before sending from Jazz. A bot cannot initiate a private conversation with a user who has never started it.

## Use

1. Restart Jazz after changing `.env`.
2. Open the dashboard.
3. In **Quick Actions**, click **Telegram Bot**. This replaces the old Translate action.
4. Jazz validates the bot token with Telegram and displays the configured bot.
5. Click the bot to open the embedded chat.
6. Messages sent in the Jazz panel are sent by the configured Telegram bot to `JAZZ_TELEGRAM_CHAT_ID`.
7. Incoming messages for that chat are polled while the panel is open and shown in the same chat window.

The bot token is read only by the local Vite server middleware and is never returned to the browser UI.
