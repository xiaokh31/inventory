FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM dependencies AS source
COPY src ./src
COPY assets ./assets
COPY scripts ./scripts
COPY server ./server
COPY api ./api
COPY db ./db
COPY unit23_available_area_clean_no_text.png ./
RUN npm run build

FROM source AS test
COPY tests ./tests
COPY vercel.json ./
RUN chown -R node:node /app
USER node
CMD ["sh", "-c", "npm test && npm run test:database && node tests/deployment-smoke.cjs"]

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=source --chown=node:node /app/package.json ./package.json
COPY --from=source --chown=node:node /app/index.html ./index.html
COPY --from=source --chown=node:node /app/server ./server
COPY --from=source --chown=node:node /app/src/app.js ./src/app.js
COPY --from=source --chown=node:node /app/db ./db
COPY --from=source --chown=node:node /app/scripts/serve.cjs /app/scripts/migrate.cjs /app/scripts/healthcheck.cjs ./scripts/
USER node
EXPOSE 4173
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=4 CMD ["node", "scripts/healthcheck.cjs"]
CMD ["node", "scripts/serve.cjs"]
