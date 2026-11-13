#!/bin/sh
set -e

# Fail fast with a readable message when the platform has no environment configured.
missing=""
for name in DATABASE_URL CLIENT_URL JWT_SECRET S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY ADMIN_EMAIL ADMIN_PASSWORD; do
  eval "value=\${$name:-}"
  [ -z "$value" ] && missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "Missing required environment variables:$missing"
  echo "Set them in your host's environment settings (Render: Environment → Add from .env)."
  exit 1
fi

# Migrations need a direct (non-pooled) connection. If DIRECT_URL is not set, derive it from DATABASE_URL:
# Neon's direct host is the pooled host without "-pooler"; any other database simply reuses DATABASE_URL.
if [ -z "$DIRECT_URL" ]; then
  export DIRECT_URL="$(printf '%s' "$DATABASE_URL" | sed 's/-pooler\././')"
  echo "DIRECT_URL not set — using DATABASE_URL without the pooler for migrations."
fi

# Apply pending migrations, optionally seed (idempotent), then start the API.
npx prisma migrate deploy
if [ "$SEED_ON_START" = "true" ]; then
  npx prisma db seed
fi
exec node dist/main.js
