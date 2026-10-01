import { describe, expect, it } from "vitest";
import { canCancel, canFail, getAllowedTransitions, validateTransition } from "./state-machine.js";

describe("validateTransition", () => {
  it("allows a legal forward transition", () => {
    const result = validateTransition("DRAFT", "SCHEDULED");
    expect(result.ok).toBe(true);
    expect(result.idempotentNoop).toBe(false);
  });

  it("treats a same-status transition as an idempotent no-op success", () => {
    const result = validateTransition("ACTIVE", "ACTIVE");
    expect(result.ok).toBe(true);
    expect(result.idempotentNoop).toBe(true);
  });

  it("rejects an illegal jump", () => {
    const result = validateTransition("DRAFT", "ACTIVE");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not allowed/);
  });

  it("rejects any transition out of COMPLETED or CANCELLED", () => {
    for (const terminal of ["COMPLETED", "CANCELLED"] as const) {
      const result = validateTransition(terminal, "SCHEDULED");
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/terminal/);
    }
  });

  it("only lets a FAILED meeting recover into PROCESSING (manual transcript/notes)", () => {
    expect(validateTransition("FAILED", "PROCESSING").ok).toBe(true);
    expect(validateTransition("FAILED", "SCHEDULED").ok).toBe(false);
    expect(validateTransition("FAILED", "COMPLETED").ok).toBe(false);
  });

  it("lets every pre-capture status fall back to manual processing", () => {
    for (const from of ["SCHEDULED", "PREPARING", "JOINING", "WAITING_FOR_ADMISSION"] as const) {
      expect(validateTransition(from, "PROCESSING").ok).toBe(true);
    }
  });

  it("allows failure from every non-terminal, non-RECORDING/PROCESSING-restricted status where defined", () => {
    expect(validateTransition("PREPARING", "FAILED").ok).toBe(true);
    expect(validateTransition("JOINING", "FAILED").ok).toBe(true);
    expect(validateTransition("WAITING_FOR_ADMISSION", "FAILED").ok).toBe(true);
    expect(validateTransition("ACTIVE", "FAILED").ok).toBe(true);
    expect(validateTransition("RECORDING", "FAILED").ok).toBe(true);
    expect(validateTransition("PROCESSING", "FAILED").ok).toBe(true);
  });

  it("does not allow cancellation once recording/processing has begun", () => {
    expect(canCancel("RECORDING")).toBe(false);
    expect(canCancel("PROCESSING")).toBe(false);
    expect(canCancel("ACTIVE")).toBe(true);
  });

  it("reports canFail correctly for terminal states", () => {
    expect(canFail("COMPLETED")).toBe(false);
    expect(canFail("FAILED")).toBe(false);
    expect(canFail("CANCELLED")).toBe(false);
    expect(canFail("SCHEDULED")).toBe(true);
  });

  it("getAllowedTransitions matches the table for a sample state", () => {
    expect(getAllowedTransitions("JOINING")).toEqual([
      "WAITING_FOR_ADMISSION",
      "ACTIVE",
      "RECORDING",
      "PROCESSING",
      "FAILED",
      "CANCELLED",
    ]);
    expect(getAllowedTransitions("COMPLETED")).toEqual([]);
  });
});
