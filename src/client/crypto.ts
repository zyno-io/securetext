import { Base64 } from 'js-base64';

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const AES_PARAMS: AesKeyGenParams = {
  name: 'AES-GCM',
  length: 128,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ['encrypt', 'decrypt']);
}

export async function exportPublicKey(keyPair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
}

export async function encryptPayload(publicKey: CryptoKey, message: string): Promise<EncryptedPayload> {
  const aesKey = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt']);

  // Encrypt the message with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedMessage = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoder.encode(message));

  // Encrypt the AES key with the receiver's RSA public key
  const aesJwk = await crypto.subtle.exportKey('jwk', aesKey);
  const encryptedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, encoder.encode(JSON.stringify(aesJwk)));

  return {
    key: Base64.fromUint8Array(new Uint8Array(encryptedKey)),
    msg: Base64.fromUint8Array(new Uint8Array(encryptedMessage)),
    iv: Base64.fromUint8Array(new Uint8Array(iv)),
  };
}

export async function decryptPayload(keyPair: CryptoKeyPair, payload: EncryptedPayload): Promise<string> {
  // Decrypt the AES key with our RSA private key
  const encKey = Base64.toUint8Array(payload.key);
  const keyBuf = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, keyPair.privateKey, encKey.buffer as ArrayBuffer);
  const aesJwk: JsonWebKey = JSON.parse(decoder.decode(keyBuf));
  const aesKey = await crypto.subtle.importKey('jwk', aesJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

  // Decrypt the message
  const iv = Base64.toUint8Array(payload.iv) as Uint8Array<ArrayBuffer>;
  const encMsg = Base64.toUint8Array(payload.msg);
  const msgBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encMsg.buffer as ArrayBuffer);
  return decoder.decode(msgBuf);
}

export function generateMagicNumbers(): number[] {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)));
}

export interface EncryptedPayload {
  key: string;
  msg: string;
  iv: string;
}
