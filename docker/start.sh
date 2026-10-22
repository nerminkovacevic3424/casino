#!/bin/sh
# Container entrypoint: apply pending migrations, make sure the admin exists, start the API.
set -e

./node_modules/.bin/prisma migrate deploy --config apps/api/prisma.config.ts
./node_modules/.bin/tsx apps/api/prisma/create-admin.ts

exec node dist/apps/api/main.js
