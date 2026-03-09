FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

RUN npm install -g html-minifier-terser@7.2.0 terser@5.39.0 csso-cli@4.0.2

COPY public ./public
RUN html-minifier-terser \
        --collapse-whitespace \
        --remove-attribute-quotes \
        --remove-comments \
        --remove-empty-attributes \
        --remove-redundant-attributes \
        --remove-script-type-attributes \
        --remove-style-link-type-attributes \
        --use-short-doctype \
        -o public/index.min.html \
        public/index.html && \
    terser -cm -o public/script.min.js -- public/script.js && \
    for f in public/vendor/*.js; do terser -cm -o "$f.min" -- "$f" && mv "$f.min" "$f"; done && \
    csso public/style.css -o public/style.min.css && \
    mv public/index.min.html public/index.html && \
    mv public/script.min.js public/script.js && \
    mv public/style.min.css public/style.css

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini && \
    addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

USER app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

EXPOSE 3000
