#!/data/data/com.termux/files/usr/bin/bash

# Jazz Android mobile unlock helper.
#
# Set JAZZ_UNLOCK_CODE in the Termux environment before running this script.
# Do not commit the unlock code to Git.
#
# Example:
#   export JAZZ_UNLOCK_CODE='YOUR_AUTH_CODE'
#   ./scripts/android/unlockmobile.sh

set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed or not available in PATH" >&2
  exit 1
fi

if [[ -z "${JAZZ_UNLOCK_CODE:-}" ]]; then
  echo "JAZZ_UNLOCK_CODE is not set" >&2
  exit 1
fi

adb shell input keyevent KEYCODE_WAKEUP
sleep 1
adb shell input text "$JAZZ_UNLOCK_CODE"
adb shell input keyevent KEYCODE_ENTER
sleep 2

echo "Mobile wake/unlock sequence completed."
