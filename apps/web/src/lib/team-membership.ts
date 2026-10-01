import { prisma } from "@meeting-assistant/db";
import { emailDomain } from "@meeting-assistant/shared";

/**
 * Puts a newly created user into the team whose internal domains include
 * their email domain (SE Copilot is an internal tool: colleagues land in
 * their team automatically, outsiders land nowhere and see nothing). The
 * very first user of a fresh installation becomes ADMIN so someone can
 * configure it.
 */
export async function onboardNewUser(userId: string, email: string): Promise<void> {
  const domain = emailDomain(email);
  const team = domain ? await prisma.team.findFirst({ where: { internalDomains: { has: domain } }, orderBy: { createdAt: "asc" } }) : null;
  const adminExists = (await prisma.user.count({ where: { role: "ADMIN", deletedAt: null, id: { not: userId } } })) > 0;

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(team ? { teamId: team.id, timezone: team.timezone } : {}),
      ...(adminExists ? {} : { role: "ADMIN" }),
    },
  });
}
