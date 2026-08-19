# ============================================================
#  One image, one school.
#
#  The image is identical for every school — a school's identity and
#  records arrive through the data file loaded after deployment, never
#  baked in here. Build once, deploy per school with its own database.
#
#      docker build -t school-portal .
#      docker run -p 5490:5490 \
#        -e DATABASE_URL=postgres://... \
#        -e ADMIN_USERNAME=admin -e ADMIN_PASSWORD=... \
#        school-portal
#
#  With no DATABASE_URL it falls back to SQLite in /app/data, which must
#  be a mounted volume — a container filesystem does not survive a
#  restart, and neither would the school.
# ============================================================
FROM node:22-slim

WORKDIR /app

# Dependencies first, so a source change does not reinstall them.
COPY package.json package-lock.json* ./

# better-sqlite3 is an optionalDependency and a native addon. If no
# prebuilt binary matches this Node ABI the install still succeeds and
# the image simply runs Postgres-only, which is what a cloud deployment
# should be doing anyway.
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# The SQLite path, when one is used. Mount a volume here.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=5490
EXPOSE 5490

# serve.js binds 0.0.0.0 whenever PORT is set, which is what a container needs.
CMD ["node", "serve.js"]
