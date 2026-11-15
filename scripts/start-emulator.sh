#!/usr/bin/env bash
# Starts the Android emulator for local development of the node app (src/node). No root needed.
#
# - Boots the AVD (any image, Google Play included).
# - Starts dnsmasq (127.0.0.1:53) and boots the emulator with `-dns-server 127.0.0.1`, so
#   *.splitcortex.127.0.0.1.nip.io resolves to 10.0.2.2 (the host) inside the emulator and reaches
#   Traefik with the right hostname for TLS. Nothing is edited in the emulator. Port 53 is privileged,
#   so dnsmasq is started with sudo. The DNS setting only applies when
#   the emulator is started by this script (stop a running one first).
# The local root CA is not handled here: install it once by hand. Debug builds of the app trust
# user CAs (plugins/withDevUserCa.js).
#
# Usage: scripts/start-emulator.sh [avd-name]      (default: the first AVD found)
set -euo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
EMULATOR="$SDK/emulator/emulator"
ADB="$SDK/platform-tools/adb"

[ -x "$EMULATOR" ] && [ -x "$ADB" ] || { echo "Android SDK not found at $SDK (set ANDROID_HOME)" >&2; exit 1; }

AVD="${1:-$("$EMULATOR" -list-avds | head -n1)}"
[ -n "$AVD" ] || { echo "No AVD found; create one in Android Studio" >&2; exit 1; }

DNS_PORT=53
command -v dnsmasq >/dev/null || { echo "dnsmasq is required (e.g. pacman -S dnsmasq)" >&2; exit 1; }
if ! pgrep -f "dnsmasq.*splitcortex" >/dev/null; then
  sudo dnsmasq --listen-address=127.0.0.1 --bind-interfaces --port="$DNS_PORT" --no-resolv --no-hosts \
    --server=1.1.1.1 --address=/splitcortex.127.0.0.1.nip.io/10.0.2.2 \
    --pid-file=/tmp/splitcortex-dnsmasq.pid ||
    { echo "dnsmasq failed to start (is another DNS server using 127.0.0.1:53?)" >&2; exit 1; }
fi

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "Starting emulator '$AVD'..."
  nohup "$EMULATOR" -avd "$AVD" -dns-server 127.0.0.1 >/tmp/splitcortex-emulator.log 2>&1 &
fi

echo "Waiting for the emulator to boot..."
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
