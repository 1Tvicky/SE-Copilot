import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { mediaUploadMetadataSchema } from "@meeting-assistant/shared";
import { getApiUser } from "@/lib/session";
import { buildStorageKey, getUploadUrl } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";

export async function GET() {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const assets = await prisma.mediaAsset.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(assets);
}

export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = mediaUploadMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { fileName, mimeType, fileSizeBytes, durationSeconds } = parsed.data;

  const storageKey = buildStorageKey("media", user.id, fileName);
  const asset = await prisma.mediaAsset.create({
    data: {
      userId: user.id,
      fileName,
      mimeType,
      fileSizeBytes,
      durationSeconds,
      storageKey,
      status: "UPLOADING",
    },
  });

  const uploadUrl = await getUploadUrl(storageKey, mimeType);

  await recordAuditEvent({ actorUserId: user.id, action: "media.upload_initiated", targetType: "MediaAsset", targetId: asset.id });

  return NextResponse.json({ id: asset.id, uploadUrl }, { status: 201 });
}
