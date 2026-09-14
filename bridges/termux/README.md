# Jazz Android / Tablet Termux Bridge

This bridge lets the Jazz API send a small, explicit allow-list of commands to your own Android phone or tablet running Termux.

## What it currently supports

- `device_info`
- `open_url` using `termux-open-url`
- `launch_app` using Android `monkey`
- `speak` using `termux-tts-speak`

It does **not** bypass Android permissions, Play Protect, lock screens, security prompts, or accessibility restrictions. More advanced actions such as screen taps, scrolling, screenshots, calls, or messaging should be added later through a dedicated Android companion/accessibility service with explicit user authorization.

## Install requirements in Termux

```bash
pkg update
pkg install nodejs
pkg install termux-api
```

Install the Termux:API Android app as well when using `speak`.

## Start one bridge

Choose a strong random token:

```bash
export JAZZ_BRIDGE_TOKEN="replace-with-a-long-random-secret"
node ~/Jazz-AI-Assistant/bridges/termux/android-bridge.mjs
```

By default it listens on port `9898`.

For a phone, configure the Jazz API with:

```bash
set JAZZ_ANDROID_PHONE_BRIDGE_URL=http://PHONE_IP:9898
set JAZZ_ANDROID_PHONE_BRIDGE_TOKEN=replace-with-the-same-secret
```

For a tablet, configure a second bridge and use:

```bash
set JAZZ_ANDROID_TABLET_BRIDGE_URL=http://TABLET_IP:9898
set JAZZ_ANDROID_TABLET_BRIDGE_TOKEN=replace-with-that-device-secret
```

On PowerShell, use `$env:NAME="value"` instead of `set NAME=value`.

## Network safety

Keep the bridge on your private LAN or localhost. Do not expose port `9898` directly to the public Internet. The bearer token is a secret and must not be committed to GitHub.
