"use client";

import * as React from "react";
import { toast } from "sonner";
import { Upload, Trash2, Play } from "lucide-react";
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_MEDIA_FILE_SIZE_BYTES,
  SUPPORTED_MEDIA_MIME_TYPES,
} from "@meeting-assistant/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MediaAsset {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
  status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
  failureReason: string | null;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function probeVideoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Number.isFinite(video.duration) ? video.duration : undefined);
    };
    video.onerror = () => resolve(undefined);
    video.src = URL.createObjectURL(file);
  });
}

export function MediaLibrary() {
  const [assets, setAssets] = React.useState<MediaAsset[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [previewAsset, setPreviewAsset] = React.useState<{ id: string; url: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(() => {
    fetch("/api/media")
      .then((res) => res.json())
      .then(setAssets);
  }, []);

  React.useEffect(refresh, [refresh]);

  async function handleFileSelected(file: File) {
    if (!SUPPORTED_MEDIA_MIME_TYPES.includes(file.type as never)) {
      toast.error("Only MP4 and WebM files are supported");
      return;
    }
    if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
      toast.error("File exceeds the 500MB limit");
      return;
    }

    const durationSeconds = await probeVideoDuration(file);
    if (durationSeconds && durationSeconds > MAX_MEDIA_DURATION_SECONDS) {
      toast.error("File exceeds the 60 minute limit");
      return;
    }

    setUploading(true);
    try {
      const createRes = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSizeBytes: file.size, durationSeconds }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        toast.error(created.error ?? "Could not start upload");
        return;
      }

      const putRes = await fetch(created.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        toast.error("Upload to storage failed");
        return;
      }

      const completeRes = await fetch(`/api/media/${created.id}/complete`, { method: "POST" });
      if (!completeRes.ok) {
        toast.error("Could not confirm the upload");
        return;
      }

      toast.success("Upload complete");
      refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handlePreview(asset: MediaAsset) {
    const res = await fetch(`/api/media/${asset.id}`);
    const data = await res.json();
    if (data.previewUrl) setPreviewAsset({ id: asset.id, url: data.previewUrl });
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Could not delete media");
      return;
    }
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Media library</h1>
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4" />
          {uploading ? "Uploading..." : "Upload media"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
            e.target.value = "";
          }}
        />
      </div>

      {assets.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No media yet</CardTitle>
            <CardDescription>Upload an MP4 or WebM file (up to 500MB, 60 minutes).</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {assets.map((asset) => (
            <Card key={asset.id}>
              <CardHeader className="pb-2">
                <CardTitle className="truncate text-sm">{asset.fileName}</CardTitle>
                <CardDescription>
                  {formatBytes(asset.fileSizeBytes)} &middot; {asset.status.toLowerCase()}
                  {asset.durationSeconds ? ` · ${Math.round(asset.durationSeconds)}s` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                {asset.status === "READY" && (
                  <Button variant="outline" size="sm" onClick={() => handlePreview(asset)}>
                    <Play className="h-4 w-4" />
                    Preview
                  </Button>
                )}
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => handleDelete(asset.id)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={previewAsset !== null} onOpenChange={(open: boolean) => !open && setPreviewAsset(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
          </DialogHeader>
          {previewAsset && <video controls autoPlay className="w-full rounded-md" src={previewAsset.url} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
