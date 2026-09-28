# Jazz VoIP Reminder Calling

This module adds an optional Asterisk-based SIP reminder-call path without replacing the existing Jazz Android, recovery, STT, TTS, or chat workflows.

## Flow

1. Mama says a reminder such as `Hey Jazz, remind me at 7 PM to take medicine`.
2. Jazz stores the reminder under `.jazz/reminders.json` and schedules it.
3. At the due time, Piper generates a WAV reminder message.
4. Jazz connects to Asterisk through ARI and originates a call to the configured PJSIP endpoint.
5. When the SIP endpoint answers and enters the `jazz-reminder` Stasis application, Jazz instructs Asterisk to play the generated reminder WAV.
6. Jazz marks the reminder completed after playback finishes.

## What is free

Asterisk, Jazz, Piper, PJSIP and SIP-to-SIP calls on your own network are open-source/free to run on your own hardware.

Calling an ordinary PSTN/mobile telephone number through a telecom carrier normally requires a SIP trunk or carrier account and may cost money. The no-subscription setup described here calls a SIP endpoint, for example an Android SIP softphone registered as extension `7001`.

## Requirements

- Asterisk with `res_pjsip`, HTTP server and ARI enabled.
- Node.js 24+ for Jazz (the existing Jazz environment already uses this).
- Piper configured in Jazz for the spoken reminder.
- A SIP client/softphone registered to Asterisk, or another SIP endpoint you own.
- Network reachability between Jazz, Asterisk and the SIP endpoint. For remote use, prefer a private VPN such as WireGuard instead of exposing SIP/ARI directly to the public internet.

## Asterisk setup

Use the examples in `services/voip/asterisk/` as templates. Do not copy example passwords unchanged.

- `http.conf.example` enables Asterisk's local HTTP interface on port 8088.
- `ari.conf.example` creates the `jazz` ARI user.
- `pjsip.conf.example` creates extension `7001` for a SIP client.

After installing the relevant snippets into the Asterisk configuration directory, reload/restart Asterisk and confirm the endpoint is registered from the Asterisk CLI:

```text
pjsip show endpoints
pjsip show contacts
http show status
ari show status
```

## Jazz setup

Copy:

```text
services/voip/.env.example
```

to:

```text
services/voip/.env
```

Set strong local credentials and the correct endpoint. `services/voip/.env` is already covered by the repository's `**/.env` ignore rule and must not be committed.

The most important values are:

```text
JAZZ_VOIP_ENABLED=true
JAZZ_ASTERISK_ARI_URL=http://127.0.0.1:8088/ari
JAZZ_ASTERISK_ARI_USER=jazz
JAZZ_ASTERISK_ARI_PASSWORD=<same ARI password configured in Asterisk>
JAZZ_ASTERISK_ENDPOINT=PJSIP/7001
JAZZ_VOIP_AUDIO_BASE_URL=http://127.0.0.1:8797
```

`JAZZ_VOIP_AUDIO_BASE_URL` must be reachable **from Asterisk itself**. If Asterisk runs in WSL, Docker, another VM, or another machine, `127.0.0.1` may point to Asterisk rather than the Windows Jazz API. In that case use a private Jazz PC address/hostname that Asterisk can reach.

## Supported natural reminder examples

```text
Hey Jazz, remind me at 7 PM to take medicine
Hey Jazz, remind me tomorrow at 8:30 AM to attend the meeting
Hey Jazz, remind me to call Mom at 6 PM
Hey Jazz, call me at 9 PM and remind me to check the deployment
```

If the clock time has already passed and no explicit `today` or `tomorrow` is provided, Jazz schedules the reminder for the next day.

## API diagnostics

Jazz exposes:

```text
GET  /api/voip/health
GET  /api/reminders
POST /api/reminders
POST /api/reminders/:id/call-now
```

The health endpoint checks ARI reachability without exposing the configured ARI password.

## Security

- Keep ARI bound to localhost/private networking whenever possible.
- Never expose ARI credentials in Git, screenshots, or public URLs.
- Use a strong SIP password for endpoint `7001`.
- Prefer WireGuard/private networking for remote SIP use.
- Do not expose the reminder-audio URL publicly. Each reminder audio request is protected by a short random per-call token generated in memory.
