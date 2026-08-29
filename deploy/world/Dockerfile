# The "world" service: hub + TrueForge in ONE container. TrueForge stays on
# loopback — standalone mode has no auth, so it must never be reachable from
# outside; the hub is the only public listener. Build context is the repo root
# (hub imports ../shared). Railway config: railway.toml at the repo root.
FROM node:22-slim

# curl is only for start.sh's wait-for-TrueForge loop
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Pinned: 0.1.4 is what the game was built against; the project is 10 days old
# and moving fast, so a floating tag could change behavior between deploys.
RUN npm install -g @truefoundry/trueforge@0.1.4

WORKDIR /app
COPY hub/package.json hub/package-lock.json hub/
# --include=dev: the hub runs through tsx, which is a devDependency
RUN npm --prefix hub ci --include=dev
COPY shared shared
COPY hub hub
COPY deploy/world/start.sh /start.sh
RUN chmod +x /start.sh

ENV NODE_ENV=production
CMD ["/start.sh"]
