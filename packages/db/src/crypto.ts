import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ENCRYPTION_KEY env var must be set to a strong secret (>=16 chars) before encrypting/decrypting credentials",
    );
  }
  // scrypt with a static, app-wide salt derived from the secret itself keeps this deterministic
  // without needing a second secret to manage; the secret itself is the actual security boundary.
  return scryptSync(secret, "meeting-assistant-credential-store", 32);
}

/** Encrypts a plaintext secret (OAuth token, meeting passcode) for storage at rest. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

/** Reverses encryptSecret. Throws if the ciphertext was tampered with or the key is wrong. */
export function decryptSecret(ciphertext: string): string {
  const [ivB64, authTagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed ciphertext");
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
