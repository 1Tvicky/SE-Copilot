import { prisma } from "@meeting-assistant/db";
import { requireUser } from "@/lib/session";
import { canManageTeam, getUserContext } from "@/lib/access";
import { Card, CardContent } from "@/components/ui/card";
import { TeamSettingsForm } from "./team-settings-form";
import { SourcesManager } from "./sources-manager";

export default async function TeamSettingsPage() {
  const user = await requireUser();
  const ctx = await getUserContext(user);
  if (!ctx.teamId) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm">You are not a member of a team. An admin can add you from Admin → Users.</CardContent>
      </Card>
    );
  }
  const team = await prisma.team.findUniqueOrThrow({ where: { id: ctx.teamId }, include: { sources: { orderBy: { createdAt: "asc" } } } });
  const editable = canManageTeam(ctx, team.id);
  const { sources, ...settings } = team;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team settings</h1>
        <p className="text-sm text-muted-foreground">
          {editable ? "Settings shared by everyone on " : "Read-only: only managers and admins can change "}
          {team.name}.
        </p>
      </div>
      <SourcesManager
        editable={editable}
        sources={sources.map((s) => ({ ...s, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }))}
      />
      <TeamSettingsForm
        editable={editable}
        initial={{
          name: settings.name,
          teamDlAddress: settings.teamDlAddress,
          teamDlDisplayName: settings.teamDlDisplayName,
          senderMailbox: settings.senderMailbox,
          emailSignature: settings.emailSignature,
          internalDomains: settings.internalDomains,
          timezone: settings.timezone,
          botEnabled: settings.botEnabled,
          botDisplayName: settings.botDisplayName,
          botJoinOffsetMinutes: settings.botJoinOffsetMinutes,
          botEligibleTypes: settings.botEligibleTypes,
          noAiMarkers: settings.noAiMarkers,
          botJoinMessage: settings.botJoinMessage,
        }}
      />
    </div>
  );
}
