import { NextResponse } from "next/server";
import { QUEUE_NAMES, buildJobId } from "@meeting-assistant/shared";
import { enqueue } from "@/lib/jobs";
import { buildZoomUrlValidationResponse, verifyZoomWebhookSignature } from "@/lib/zoom-webhook-signature";

const RELEVANT_EVENTS = new Set(["meeting.started", "meeting.ended", "recording.completed"]);

export async function POST(request: Request) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) {
    console.error("ZOOM_WEBHOOK_SECRET_TOKEN is not configured — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const timestamp = request.headers.get("x-zm-request-timestamp");
  const signature = request.headers.get("x-zm-signature");

  if (!timestamp || !signature || !verifyZoomWebhookSignature(rawBody, timestamp, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { event: string; event_ts: number; payload: Record<string, unknown> };

  // Zoom sends this once when you register the webhook URL, to prove you
  // control the endpoint. It must be answered with an HMAC of the token
  // Zoom gave us, using the same webhook secret — not enqueued as a job.
  if (body.event === "endpoint.url_validation") {
    const plainToken = (body.payload as { plainToken: string }).plainToken;
    return NextResponse.json(buildZoomUrlValidationResponse(plainToken, secret));
  }

  if (!RELEVANT_EVENTS.has(body.event)) {
    return NextResponse.json({ message: "Ignored" });
  }

  // Hand off to the worker immediately; webhook handlers must respond fast
  // or Zoom will retry (and eventually disable the webhook).
  const object = body.payload.object as { uuid?: string; id?: string | number } | undefined;
  const objectRef = object?.uuid ?? object?.id ?? "unknown";

  try {
    await enqueue(
      QUEUE_NAMES.zoomWebhookEvents,
      { eventType: body.event, eventTs: body.event_ts, payload: body.payload },
      { singletonKey: buildJobId(body.event, String(objectRef), body.event_ts) },
    );
  } catch (err) {
    console.error("Failed to enqueue Zoom webhook event", { event: body.event, err });
    // 5xx tells Zoom to retry the delivery later instead of silently dropping it.
    return NextResponse.json({ error: "Could not queue event for processing" }, { status: 503 });
  }

  return NextResponse.json({ message: "Accepted", queue: QUEUE_NAMES.zoomWebhookEvents });
}
