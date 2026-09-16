#!/bin/sh
# Starts as root only long enough to make the storage directory writable for the app user, then
# drops privileges. Coolify bind-mounts a host directory that Docker creates as root:root, and
# without shell access to the host nobody could `chown` it before the first deploy.
set -e

if [ "$(id -u)" = "0" ]; then
  dir="${STORAGE_DIR:-/app/storage}"
  mkdir -p "$dir"
  # a recursive chown only when the app user cannot write there (fresh mount), not on every start
  if ! setpriv --reuid=exlibris --regid=exlibris --init-groups test -w "$dir"; then
    echo "[entrypoint] giving $dir to the exlibris user"
    chown -R exlibris:exlibris "$dir"
  fi
  exec setpriv --reuid=exlibris --regid=exlibris --init-groups "$@"
fi

exec "$@"
