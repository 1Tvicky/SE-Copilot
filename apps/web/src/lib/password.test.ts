import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("Str0ngPassw0rd!");
    expect(hash).not.toBe("Str0ngPassw0rd!");
    await expect(verifyPassword(hash, "Str0ngPassw0rd!")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Str0ngPassw0rd!");
    await expect(verifyPassword(hash, "WrongPassword1")).resolves.toBe(false);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything")).resolves.toBe(false);
  });
});
