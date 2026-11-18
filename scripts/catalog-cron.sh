#!/bin/sh
# Registered in the Jino scheduler only after activation is approved.
umask 077
set -u
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2
export PATH=/usr/bin:/bin
/usr/bin/timeout -k 10 240 /usr/bin/python3 -B "$self_dir/catalog_sync.py" run >/dev/null
result=$?
case "$result" in
  0) exit 0 ;;
  124|137)
    /usr/bin/timeout -k 5 30 /usr/bin/python3 -B "$self_dir/catalog_sync.py" interrupted >/dev/null
    printf '%s\n' 'DOM-U-MORYA: catalog sync reached the Cron time limit.'
    ;;
  *)
    printf 'DOM-U-MORYA: catalog sync exited with code %s. Check catalog_sync.py status.\n' "$result"
    ;;
esac
exit "$result"
