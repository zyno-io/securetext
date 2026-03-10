FROM node:24-alpine AS build

RUN corepack enable

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN yarn build

FROM node:24-alpine

RUN corepack enable

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S app -G app

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --production

COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/public ./public

USER app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

EXPOSE 3000
