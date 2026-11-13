#!/bin/sh
set -e
# Apply pending migrations, optionally seed (idempotent), then start the API.
npx prisma migrate deploy
if [ "$SEED_ON_START" = "true" ]; then
  npx prisma db seed
fi
exec node dist/main.js
