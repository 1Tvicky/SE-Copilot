import { PrismaClient } from "@prisma/client";
import { ZOOM_CAPABILITIES } from "@meeting-assistant/shared";

const prisma = new PrismaClient();

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

async function main() {
  await prisma.meetingProviderRecord.upsert({
    where: { platform: "ZOOM" },
    update: { displayName: "Zoom", isEnabled: true, capabilitiesJson: ZOOM_CAPABILITIES as unknown as object },
    create: { platform: "ZOOM", displayName: "Zoom", isEnabled: true, capabilitiesJson: ZOOM_CAPABILITIES as unknown as object },
  });
  console.log("Seeded meeting_providers: zoom");

  // The SE team. Only created when none exists; after that it is managed in
  // Settings → Team, and re-running the seed never overwrites those edits.
  const existing = await prisma.team.findFirst();
  if (existing) {
    console.log(`Team already exists (${existing.name}); leaving it unchanged`);
  } else {
    const team = await prisma.team.create({
      data: {
        name: process.env.TEAM_NAME || "Solution Engineering",
        teamDlAddress: process.env.TEAM_DL?.trim().toLowerCase() || null,
        teamDlDisplayName: process.env.TEAM_DL_DISPLAY_NAME || "Solution Engineering Team",
        senderMailbox: process.env.EMAIL_SENDER_MAILBOX?.trim().toLowerCase() || process.env.TEAM_DL?.trim().toLowerCase() || null,
        internalDomains: list(process.env.INTERNAL_DOMAINS),
        timezone: process.env.TEAM_TIMEZONE || "UTC",
      },
    });
    console.log(`Created team "${team.name}"`);

    if (process.env.TEAM_MEETING_SOURCE_MAILBOX) {
      await prisma.teamMeetingSource.create({
        data: {
          teamId: team.id,
          type: "SHARED_MAILBOX",
          displayName: "Team meeting mailbox",
          mailboxAddress: process.env.TEAM_MEETING_SOURCE_MAILBOX.trim().toLowerCase(),
        },
      });
      console.log(`Added meeting source ${process.env.TEAM_MEETING_SOURCE_MAILBOX}`);
    }

    // Existing users whose email domain is internal join the new team.
    const domains = team.internalDomains;
    if (domains.length > 0) {
      const users = await prisma.user.findMany({ where: { teamId: null } });
      const members = users.filter((u) => domains.some((d) => u.email.toLowerCase().endsWith(`@${d}`)));
      for (const u of members) await prisma.user.update({ where: { id: u.id }, data: { teamId: team.id } });
      if (members.length) console.log(`Added ${members.length} existing user(s) to the team`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
