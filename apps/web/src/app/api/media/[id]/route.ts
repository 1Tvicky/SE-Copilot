import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiUser } from "@/lib/session";
import { deleteObject, getDownloadUrl } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";

async function loadOwnedAsset(id: string, userId: string) {
  return prisma.mediaAsset.findFirst({ where: { id, userId, deletedAt: null } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const asset = await loadOwnedAsset(id, user.id);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const previewUrl = asset.status === "READY" ? await getDownloadUrl(asset.storageKey) : null;
  return NextResponse.json({ ...asset, previewUrl });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const asset = await loadOwnedAsset(id, user.id);
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await deleteObject(asset.storageKey).catch((err) => {
    console.error("Failed to delete object from storage", { storageKey: asset.storageKey, err });
  });
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });

  await recordAuditEvent({ actorUserId: user.id, action: "media.deleted", targetType: "MediaAsset", targetId: asset.id });

  return NextResponse.json({ message: "Deleted" });
}
