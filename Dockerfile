FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build

RUN corepack enable

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

COPY tsconfig.json tsconfig.client.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN yarn build

FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

RUN corepack enable

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S app -G app

COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --production

COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/dist/public ./public

USER app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

EXPOSE 3000
