#!/bin/sh
set -e

case "$1" in
  auth)
    # Interactive: prompts for email, password and 2FA code, prints a refresh token.
    shift
    exec node /app/node_modules/ring-client-api/lib/ring-auth-cli.js "$@"
    ;;
  run)
    ;;
  *)
    exec "$@"
    ;;
esac

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$RECORDINGS_DIR"
  # /data is app-private, so taking ownership is safe. /recordings is left alone
  # because NAS datasets/shares usually carry ACLs that must not be rewritten.
  chown -R "$PUID:$PGID" "$DATA_DIR"
  if ! su-exec "$PUID:$PGID" sh -c "touch '$RECORDINGS_DIR/.write-test' && rm -f '$RECORDINGS_DIR/.write-test'"; then
    echo "ERROR: UID $PUID / GID $PGID cannot write to $RECORDINGS_DIR." >&2
    echo "Grant that user/group modify permission on the dataset or share mounted there." >&2
    exit 1
  fi
  exec su-exec "$PUID:$PGID" node /app/src/index.js
fi

exec node /app/src/index.js
