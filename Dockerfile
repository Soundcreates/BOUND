# BOUND aggregator (server/watcher/local-intake.mjs).
#
# The image holds no state and no secrets. On start it rebuilds its journals from what
# its writer key already published on Arkiv, so a replacement container is an exact copy
# of the one that stopped. Run exactly ONE container per writer key.
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t <dockerhub-user>/bound-aggregator:<tag> --push .
#   docker run -v "$PWD/.env:/etc/secrets/.env:ro" -p 8787:8787 aadish021/bound-aggregator
#
# Secrets are read from /etc/secrets/.env (a Render secret file; override with BOUND_ENV_FILE)
# or from ordinary environment variables, which take precedence.
FROM node:22-slim

ENV NODE_ENV=production \
    BOUND_STATE_DIR=/tmp/bound \
    BOUND_INTAKE_HOST=0.0.0.0 \
    BOUND_INTAKE_PORT=8787
WORKDIR /app

# Only the two runtime dependencies, pinned to the versions in package-lock.json.
# The repo's workspace manifest is not copied, so the extension and landing page
# dependencies are never installed here.
RUN printf '{"name":"bound-aggregator","private":true,"type":"module","dependencies":{"ethers":"6.17.0","@hpke/core":"1.10.0"}}' > package.json \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY shared/contracts ./shared/contracts
COPY shared/integrations/arkiv ./shared/integrations/arkiv
COPY shared/integrations/report-crypto ./shared/integrations/report-crypto
COPY server/watcher ./server/watcher

USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.BOUND_INTAKE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/watcher/local-intake.mjs"]
