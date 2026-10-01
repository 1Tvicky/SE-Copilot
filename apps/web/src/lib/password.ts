import * as argon2 from "argon2";

/**
 * argon2id with reasonably strong defaults for an interactive login path
 * (not so slow that it becomes a DoS vector under rate limiting, not so fast
 * that it's cheap to brute-force offline).
 */
const HASH_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
