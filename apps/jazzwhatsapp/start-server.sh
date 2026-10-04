#!/data/data/com.termux/files/usr/bin/bash
set -eu
cd "$(dirname "$0")/../.."
export PORT="${PORT:-8797}"
export JAZZ_REMINDER_DELIVERY=jazzwhatsapp
export JAZZWHATSAPP_ALLOW_SIGNUP="${JAZZWHATSAPP_ALLOW_SIGNUP:-false}"
export JAZZ_NORMAL_MODEL="${JAZZ_NORMAL_MODEL:-qwen3:0.6b}"
export JAZZ_EVIL_MODEL="${JAZZ_EVIL_MODEL:-dolphin-phi:2.7b-v2.6-q2_K}"
export JAZZ_VISION_MODEL="${JAZZ_VISION_MODEL:-moondream}"
exec node services/api/src/server.mjs
