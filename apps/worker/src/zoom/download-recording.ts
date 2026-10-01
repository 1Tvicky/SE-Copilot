import { getZoomAccessToken } from "./oauth.js";

const ZOOM_API_BASE = "https://api.zoom.us/v2";

interface ZoomRecordingFile {
  id: string;
  file_type: string;
  download_url: string;
}

/**
 * The download_url in the original recording.completed webhook expires
 * quickly, so we re-fetch the meeting's current recording listing to get a
 * fresh one, then download the bytes ourselves (Zoom requires the access
 * token appended as a query param on recording downloads, not just the
 * Authorization header).
 */
export async function downloadZoomRecordingFile(
  meetingUuidOrId: string,
  externalRecordingId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = await getZoomAccessToken();
  const encodedMeetingId = encodeURIComponent(encodeURIComponent(meetingUuidOrId));

  const listRes = await fetch(`${ZOOM_API_BASE}/meetings/${encodedMeetingId}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list Zoom recordings (status ${listRes.status})`);
  }
  const listData = (await listRes.json()) as { recording_files: ZoomRecordingFile[] };
  const file = listData.recording_files.find((f) => f.id === externalRecordingId);
  if (!file) {
    throw new Error(`Recording file ${externalRecordingId} was not found in Zoom's current listing`);
  }

  const downloadRes = await fetch(`${file.download_url}?access_token=${token}`);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download Zoom recording file (status ${downloadRes.status})`);
  }

  const mimeType = downloadRes.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  return { buffer, mimeType };
}
