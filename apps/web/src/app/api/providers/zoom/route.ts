import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/session";
import { getZoomCapabilities, getZoomProviderRecord } from "@/lib/meeting-provider";

export async function GET() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await getZoomProviderRecord();
  return NextResponse.json(getZoomCapabilities(record));
}
