import { describe, expect, it } from "vitest";
import { buildJobId } from "./queues.js";

describe("buildJobId", () => {
  it("joins parts with a hyphen", () => {
    expect(buildJobId("watch-start", "abc-123")).toBe("watch-start-abc-123");
  });

  it("never contains a colon", () => {
    const id = buildJobId("meeting.started", "uuid-with-dots.and.stuff", 1700000000);
    expect(id).not.toContain(":");
  });

  it("accepts numeric parts", () => {
    expect(buildJobId("summarize", "session-1", 1700000000)).toBe("summarize-session-1-1700000000");
  });
});
