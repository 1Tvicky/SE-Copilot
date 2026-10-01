import { NextResponse } from "next/server";
import { QUEUE_NAMES, type BotEventJobData } from "@meeting-assistant/shared";
import { enqueue } from "@/lib/jobs";
import { readWebhookSignatureHeaders, verifyRecallWebhookSignature } from "@/lib/recall-webhook-signature";

interface RecallWebhookBody {
  event?: string;
  data?: {
    data?: { code?: string; sub_code?: string | null; updated_at?: string | null } | null;
    bot?: { id?: string; metadata?: Record<string, string> } | null;
  };
}

/**
 * Recall.ai bot status / transcript webhooks. Signature-verified, then handed
 * to the worker immediately so we respond fast (slow responses get retried
 * and eventually disabled by the sender).
 */
export async function POST(request: Request) {
  const secret = process.env.RECALL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("RECALL_WEBHOOK_SECRET is not configured — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const headers = readWebhookSignatureHeaders(request.headers);
  if (!verifyRecallWebhookSignature(rawBody, headers, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: RecallWebhookBody;
  try {
    body = JSON.parse(rawBody) as RecallWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = body.event ?? "";
  const botId = body.data?.bot?.id;
  const relevant = event.startsWith("bot.") || event === "transcript.done" || event === "transcript.failed";
  if (!relevant || !botId) return NextResponse.json({ message: "Ignored" });

  const job: BotEventJobData = {
    provider: "recall",
    event,
    externalBotId: botId,
    code: body.data?.data?.code ?? (event.startsWith("bot.") ? event.slice(4) : null),
    subCode: body.data?.data?.sub_code ?? null,
    occurredAt: body.data?.data?.updated_at ?? null,
    deliveryId: headers.id!,
  };

  try {
    await enqueue(QUEUE_NAMES.botEvents, job);
  } catch (err) {
    console.error("Failed to enqueue Recall webhook", { event, err });
    // 5xx makes the sender retry later instead of dropping the event.
    return NextResponse.json({ error: "Could not queue event" }, { status: 503 });
  }
  return NextResponse.json({ message: "Accepted" });
}
