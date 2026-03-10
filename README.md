# securetext.io

End-to-end encrypted text sharing — no accounts, no storage, no history.

A relay server (hosted by [Zyno Consulting](https://zyno.io)) connects the sender and receiver's browsers, but it only ever sees encrypted ciphertext and HMAC signatures. It never has access to the shared secret, the plaintext, or the encryption keys.

## How it works

1. The **sender** opens securetext.io and gets a share link. The link contains a random shared secret in the URL fragment, which browsers never send to the server.
2. The **receiver** opens the link. Their browser generates an RSA-2048 key pair and sends the public key through the relay, along with an HMAC-SHA-256 proof derived from the shared secret.
3. The **sender's** browser verifies the HMAC before trusting the key. The connection is cryptographically authenticated at this point. Three magic numbers derived from the public key are also displayed so both sides can visually confirm the connection if desired.
4. The **sender** encrypts the message with a random 128-bit AES-GCM key, wraps that key with the receiver's RSA public key, and signs the entire payload with the shared secret. Only the resulting ciphertext and signatures pass through the relay.
5. The **receiver** verifies the signature, decrypts the AES key with their private RSA key, and recovers the message.

## What the relay server sees

| Data | Visible to relay? |
|---|---|
| Shared secret | No — stays in URL fragment |
| RSA private key | No — never leaves receiver's browser |
| AES encryption key | No — RSA-encrypted |
| Plaintext message | No — AES-GCM encrypted |
| RSA public key (encrypted form) | Yes |
| HMAC signatures | Yes |
| Encrypted ciphertext | Yes |
| IP addresses | Yes |

## Tech stack

- **Server:** Node.js, Fastify, WebSocket (`ws`)
- **Client:** Alpine.js, Web Crypto API, bundled with esbuild
- **Language:** TypeScript (server + client)
- **Package manager:** Yarn Berry

## Development

```bash
yarn install
yarn dev          # build client + start dev server with hot reload
yarn test         # run tests
yarn typecheck    # type-check server and client
yarn build        # compile server + bundle/minify client
yarn start        # run compiled server
```

Requires Node.js 22+ and Corepack enabled (`corepack enable`).

## Docker

```bash
docker compose up --build
```

Or manually:

```bash
docker build -t securetext .
docker run -p 3000:3000 securetext
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server listen port |
| `TRUST_PROXY` | unset | When set to `true`, `1`, `yes`, or `on`, rate limiting uses the last IP in `X-Forwarded-For` |
| `WS_ALLOWED_ORIGINS` | unset | Comma-separated allowlist of browser `Origin` values accepted on `/ws` |
