import { prisma } from "@meeting-assistant/db";
import type { ProviderCapabilities } from "@meeting-assistant/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProviderToggle } from "./provider-toggle";

export default async function AdminProvidersPage() {
  const providers = await prisma.meetingProviderRecord.findMany({ orderBy: { platform: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Meeting providers</h1>
      {providers.map((provider) => {
        const capabilities = provider.capabilitiesJson as unknown as ProviderCapabilities;
        return (
          <Card key={provider.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{provider.displayName}</CardTitle>
                <CardDescription>Platform: {provider.platform}</CardDescription>
              </div>
              <ProviderToggle providerId={provider.id} enabled={provider.isEnabled} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(capabilities)
                  .filter(([key]) => key.startsWith("can"))
                  .map(([key, value]) => (
                    <Badge key={key} variant={value ? "success" : "muted"}>
                      {key}: {String(value)}
                    </Badge>
                  ))}
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Known limitations</p>
                <ul className="list-inside list-disc text-sm">
                  {capabilities.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {providers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No providers seeded yet. Run <code>npm run db:seed</code>.
        </p>
      )}
    </div>
  );
}
