#!/bin/sh
# Hosted entry point (see modal_app.py): a headless Chromium for Navigator (restarted if it dies, e.g. out of
# memory), then the server. VOICENAV_NAVIGATOR=off skips Chromium for a Studio-only instance.
set -e
if [ "${VOICENAV_NAVIGATOR:-on}" != "off" ]; then
  (
    while true; do
      chromium --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run \
        --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 \
        --user-data-dir=/tmp/voicenav-chrome --window-size=1120,780 about:blank >/tmp/chromium.log 2>&1 || true
      sleep 2
    done
  ) &
  export BU_CDP_URL=http://127.0.0.1:9222
fi
exec python -m voicenav.server
