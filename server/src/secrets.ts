import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.SCHEMAFORGE_MASTER_KEY;
  if (envKey) {
    cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedKey;
  }
  const keyPath = path.join(config.dataDir, 'master.key');
  if (fs.existsSync(keyPath)) {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  } else {
    cachedKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, cachedKey.toString('hex'), { mode: 0o600 });
  }
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(':');
  const key = loadKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Replace any secret-looking values in text before it reaches an AI model or the UI. */
export function redactSecrets(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('[REDACTED]');
  }
  return out;
}
