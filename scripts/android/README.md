# Jazz Android scripts

Put Mama's approved Android automation scripts in this directory.

Examples:

- `unlock.sh`
- `paymom.sh`
- `insta.sh`
- `youtube.sh`
- `screenshot.sh`

A script is only executable by Jazz when it is explicitly registered in
`services/api/src/script-registry.mjs`.

## Environment provided to scripts

- `JAZZ_DEVICE_ID` - `android-phone` or `android-tablet`
- `JAZZ_ANDROID_SERIAL` - current ADB serial for the selected device
- `ADB_PATH` - configured Windows ADB executable path

Do not put passwords, PINs, UPI PINs, API keys, or other secrets in scripts.
Sensitive financial actions should stop for Mama's explicit confirmation/authentication.

## Adding a future script

1. Add the `.sh` file here.
2. Register it in `services/api/src/script-registry.mjs`.
3. Give it a natural-language intent/aliases.
4. Restart the Jazz API and Windows ADB bridge.
