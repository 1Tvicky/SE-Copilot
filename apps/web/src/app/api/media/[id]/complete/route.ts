import { NextResponse } from "next/server";
import { prisma } from "@meeting-assistant/db";
import { getApiUser } from "@/lib/session";
import { headObject } from "@/lib/storage";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, userId: user.id } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const head = await headObject(asset.storageKey);
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "READY", fileSizeBytes: head.ContentLength ?? asset.fileSizeBytes },
    });
    return NextResponse.json({ message: "Upload confirmed" });
  } catch (err) {
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", failureReason: "Upload could not be verified in storage" },
    });
    console.error("Media upload verification failed", { assetId: asset.id, err });
    return NextResponse.json({ error: "Could not verify the upload completed" }, { status: 502 });
  }
}
