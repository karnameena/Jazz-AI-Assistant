# JazzWhatsApp

A separate Android messaging and calling client for the existing Jazz API. The UI is a bundled, offline HTML/CSS/JavaScript interface inside a native Android shell. Networking, authentication storage, realtime delivery, microphone capture, speech playback, notifications and Telecom are native Java. No external web assets or paid call provider are required.

## What works in this implementation

- Dark WhatsApp-style chat, streamed Jazz replies, history, quoted replies, reactions, copy/share/delete and photo sharing.
- Your profile and Jazz's configurable name, about and profile picture.
- One personal owner account, hashed password, device sessions and sign-out.
- Reminders in the **same** `.jazz/reminders.json` store used by the existing dashboard and Asterisk integration.
- A due reminder becomes a chat message; a configurable unanswered delay generates an incoming app call.
- Quoted completion replies finish the matching reminder; an unquoted `Done` also works when exactly one reminder is pending. Other quoted responses acknowledge it. Snooze schedules it again. Reading alone does not acknowledge it.
- Incoming call notifications, self-managed Android Telecom connection, lock-screen full-screen call activity, Answer/Decline, timeout and call history.
- Outgoing Jazz voice sessions, local Whisper STT through the existing speech service, Piper TTS through the existing API, Android speech/TTS fallback, mute, speaker and interrupt controls.
- An orb driven by microphone RMS and Piper playback amplitude. Android TTS fallback uses speech range callbacks; it does not expose the same waveform data.
- Existing Android commands still go through the original Jazz intent/tool paths. Recovery opens the existing recovery website.

## Start the same Jazz server

Use Node 22+ and install the workspace dependencies as usual (`pnpm install`). The API adds the open-source `ws` package.

In PowerShell, from the repository root:

```powershell
$env:PORT="8797"
$env:JAZZWHATSAPP_ALLOW_SIGNUP="true"
$env:JAZZ_REMINDER_DELIVERY="jazzwhatsapp"
node .\services\api\src\server.mjs
```

`JAZZ_REMINDER_DELIVERY=jazzwhatsapp` opts dashboard-created reminders into app message/call delivery. Without this variable, the original dashboard/Asterisk delivery remains the default. Reminders created inside JazzWhatsApp always use app delivery. Existing stored Asterisk reminders are not migrated or altered.

Start your existing local STT and Ollama services. For local voice recognition:

```powershell
node .\services\stt\server.mjs
```

Optional configuration:

```text
JAZZ_STT_URL=http://127.0.0.1:8798
JAZZ_TIMEZONE=Asia/Kolkata
```

Open the app, enter the **phone-reachable** API URL (for example `http://192.168.1.10:8797` on a private LAN), and create the first account with a username and password of at least eight characters. `localhost` on your phone points at the phone, not the PC.

After the first account exists, restart the API with `JAZZWHATSAPP_ALLOW_SIGNUP` unset. Existing sign-in continues to work. This version supports one personal owner; it is not a multi-user messaging service. Use HTTPS/WSS when exposing the app endpoints outside your private LAN; secure the existing legacy API routes according to your existing setup.

## Build and install

Install JDK 17 and Android SDK platform/build tools 34, or open this folder in Android Studio.

```powershell
cd .\apps\jazzwhatsapp
.\gradlew.bat assembleDebug lintDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Linux/Termux with compatible build tooling:

```bash
cd apps/jazzwhatsapp
./gradlew assembleDebug lintDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The package is `com.gunakarna.jazzwhatsapp`, so it installs alongside Android Companion. The debug APK uses a debug signing key; keep the same signing key for future upgrades, or use your own release signing process.

Allow notifications and microphone access. In Settings → Incoming call display, enable full-screen calls. Check Settings → Battery settings if your OEM suspends the connection service. No Accessibility permission is required by this app.

## Test the reminder flow

1. Connect the app and check that the home screen says **Connected**.
2. Create a reminder one minute ahead; select a 30-second unanswered delay.
3. Check that it appears in both the app and the existing `/api/reminders` source.
4. Wait for the reminder message. Quote it and send `Done`: the reminder must complete without a call.
5. Create another reminder and leave it unanswered. Lock the phone. After the selected delay, answer the Jazz call.
6. Jazz reads the reminder. Say `Done`, then ask a follow-up question. Test mute, speaker, interrupt and End call.
7. Test snooze, declining a call, app reconnect, server restart, notification/full-screen permission denied, and a long device idle period.

Automated server checks:

```bash
node --test services/api/src/voip-reminders.test.mjs services/api/src/jazzwhatsapp/*.test.mjs
node services/api/tests/utterance-normalizer.test.mjs
```

## Verified in the build environment

`assembleDebug` and `lintDebug` passed. Lint reported zero errors and two warnings for lock-screen manifest attributes on the minimum Android 8.0 target; code includes the compatible window-flag fallback.

Ten Node test cases passed across the reminder/app/server suites, and the existing 29 utterance-understanding checks passed. The real API tests use a local mock model server and verify shared AI routing, streaming, Android intent routing, old chat routes and shared dashboard/app reminder storage. Browser UI smoke checks passed at phone/tablet sizes with a mocked native bridge and no JavaScript errors. No real Android device or emulator was used, so microphone, OEM background behavior and lock-screen calls remain device acceptance tests.

## Practical limits

The API must remain running and reachable. A WebSocket foreground connection alone cannot guarantee delivery after Android force-stop, network loss or OEM termination. Server scheduling is checked each second; delivery is not an exact-time guarantee during outages. Native microphone and lock-screen behavior must be verified on the target phone.

Voice is turn-based with short silence detection, not a WebRTC full-duplex call. Local Whisper/Piper must be installed for the fully self-hosted speech path. The optional Android recognizer prefers offline speech but availability depends on the installed recognizer and language packs. Photos are shared and stored; this implementation does not add an image-understanding model. Human contacts/groups and video calls are outside this AI-only version.

The approved chat/phone app icon was not present among the supplied files; `res/drawable/jazz_icon.xml` is a replaceable purple chat/phone placeholder. The supplied glowing voice-circle image was used as the call-screen reference.


### Version 1.0.3

Update both the Android APK and API source, then restart the API. Check `GET /api/jazzwhatsapp/version` returns `apiVersion: "1.0.3"`. The client warns about older servers and prevents chat actions against incompatible APIs.

Chat menu supports Clear chat and Select messages, including Select all and bulk delete. Clear does not cancel scheduled reminders. In-flight model replies are discarded if their source message was cleared/deleted. Existing automatic Jazz quotes and deleted placeholders are removed on API startup.

Natural mode requests such as "Could you please turn on evil mode" and "Change to normal mode" verify the configured Ollama model before changing the persistent account mode. Defaults are Qwen 0.6b for normal and Dolphin Phi 2.7b for the existing Ethical Hack Lab mode. Missing/unavailable models produce an error without switching. The header reports the selected model. Short messages and emojis go through conversation handling; recurring introduction text is removed from context and retried once with a direct-answer prompt.

A due reminder sends a plain message first, then an actionable Done/Snooze card after up to 30 seconds, then calls after the configured unanswered delay (120 seconds by default). Promises to do a task acknowledge it; they do not mark it completed. Acknowledgements, answered/declined/missed reminder calls receive a follow-up after 10 minutes until completion/cancellation. Driving/call-back replies snooze 10 minutes and end the active reminder call. Completion phrases include "done Jazz", "I drunk water", and "I bought the medicine". Negations and future intentions keep the task open. Ambiguous replies with multiple pending reminders require a quoted reply or a uniquely matching task. This is phrase-based recognition; arbitrary wording is not guaranteed.

Tablet chat uses the existing server device/script handlers and their PC-side control connections. Mobile unlock requires a session-scoped confirmation within 60 seconds. Other device controls retain their existing backend requirements; the tablet does not create a new phone control bridge.


### Version 1.0.4

Update both source and APK. `GET /api/jazzwhatsapp/version` must return 1.0.4.
The chat three-dot menu is now an upper-right dropdown. The header displays online/typing/connection status, without model names.
"Turn normal mode" and "Turn evil mode" are recognized in addition to the existing polite commands.
Model context excludes scheduler notifications and control replies. Generated app prose is checked before delivery to remove copied reminder templates and P.S./P.P.S. filler; fenced code is preserved. If filtering leaves an empty reply, it is retried once. This is a targeted guard, not a guarantee of model accuracy.
Missed reminder calls now retry directly 5 minutes after the first miss, 5 minutes after the second, then 15 minutes after each subsequent miss. Each interval starts when the preceding call is marked missed (after about 45 seconds ringing). The missed-attempt count and next-call time persist in the shared reminder store. Completion/cancellation stops retries; snooze overrides the retry time. Explicit acknowledgement/answered calls retain the existing 10-minute text follow-up. Earlier version 1.0.3's missed-call 10-minute text schedule is superseded.
