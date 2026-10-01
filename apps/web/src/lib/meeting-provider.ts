import { prisma } from "@meeting-assistant/db";
import { ZOOM_CAPABILITIES, type ProviderCapabilities } from "@meeting-assistant/shared";

/**
 * The meeting_providers row is the authoritative registry (an admin can
 * flip isEnabled), but if it hasn't been seeded yet we still want the app
 * to work with the correct, honest capability set rather than fail closed.
 */
export async function getZoomProviderRecord() {
  const record = await prisma.meetingProviderRecord.findUnique({ where: { platform: "ZOOM" } });
  if (!record) {
    console.warn("meeting_providers row for ZOOM is missing — run `npm run db:seed`.");
  }
  return record;
}

export function getZoomCapabilities(
  record: { capabilitiesJson: unknown; isEnabled: boolean } | null,
): ProviderCapabilities & { isEnabled: boolean } {
  const capabilities = (record?.capabilitiesJson as ProviderCapabilities | undefined) ?? ZOOM_CAPABILITIES;
  return { ...capabilities, isEnabled: record?.isEnabled ?? true };
}
