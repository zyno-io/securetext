import { Base64 } from 'js-base64';
import type { EncryptedPayload } from './crypto.js';

const HMAC_ALGORITHM = { name: 'HMAC', hash: 'SHA-256' } as const;
const encoder = new TextEncoder();
const MAGIC_NUMBER_COUNT = 3;
const SHARE_SECRET_BYTES = 32;

function toSafeBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);
  return safeBytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Base64.fromUint8Array(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  return Base64.toUint8Array(normalized);
}

async function importAuthKey(sharedSecret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toSafeBytes(decodeBase64Url(sharedSecret)),
    HMAC_ALGORITHM,
    false,
    ['sign', 'verify'],
  );
}

async function signValue(sharedSecret: string, value: string): Promise<string> {
  const key = await importAuthKey(sharedSecret);
  const mac = await crypto.subtle.sign(HMAC_ALGORITHM.name, key, encoder.encode(value));
  return Base64.fromUint8Array(new Uint8Array(mac));
}

async function verifyValue(sharedSecret: string, value: string, mac: string): Promise<boolean> {
  const key = await importAuthKey(sharedSecret);
  return crypto.subtle.verify(HMAC_ALGORITHM.name, key, toSafeBytes(Base64.toUint8Array(mac)), encoder.encode(value));
}

function serializeEncryptedPayload(payload: EncryptedPayload): string {
  return `${payload.key}.${payload.iv}.${payload.msg}`;
}

export interface ShareLinkState {
  senderId: string | null;
  sharedSecret: string | null;
  isLegacy: boolean;
}

export function createShareSecret(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(SHARE_SECRET_BYTES)));
}

export function buildShareLink(currentHref: string, senderId: string, sharedSecret: string): string {
  const url = new URL(currentHref);
  url.hash = `${senderId}.${sharedSecret}`;
  return url.toString();
}

export function parseShareHash(hash: string): ShareLinkState {
  const trimmedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!trimmedHash) {
    return { senderId: null, sharedSecret: null, isLegacy: false };
  }

  const [senderId, sharedSecret, ...rest] = trimmedHash.split('.');
  if (!senderId || !sharedSecret || rest.length > 0) {
    return { senderId: null, sharedSecret: null, isLegacy: true };
  }

  try {
    decodeBase64Url(sharedSecret);
  } catch {
    return { senderId: null, sharedSecret: null, isLegacy: true };
  }

  return { senderId, sharedSecret, isLegacy: false };
}

export async function deriveMagicNumbers(publicKey: string): Promise<number[]> {
  const keyBytes = Base64.toUint8Array(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toSafeBytes(keyBytes)));
  return Array.from(digest.slice(0, MAGIC_NUMBER_COUNT));
}

export async function signPubkeyMessage(sharedSecret: string, publicKey: string): Promise<string> {
  return signValue(sharedSecret, `pubkey.${publicKey}`);
}

export async function verifyPubkeyMessage(sharedSecret: string, publicKey: string, mac: string): Promise<boolean> {
  return verifyValue(sharedSecret, `pubkey.${publicKey}`, mac);
}

export async function signEncryptedPayload(sharedSecret: string, payload: EncryptedPayload): Promise<string> {
  return signValue(sharedSecret, `encmsg.${serializeEncryptedPayload(payload)}`);
}

export async function verifyEncryptedPayload(
  sharedSecret: string,
  payload: EncryptedPayload,
  mac: string,
): Promise<boolean> {
  return verifyValue(sharedSecret, `encmsg.${serializeEncryptedPayload(payload)}`, mac);
}
