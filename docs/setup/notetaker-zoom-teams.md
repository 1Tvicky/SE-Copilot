# AI notetaker for Zoom & Microsoft Teams

SE Copilot uses **[Recall.ai](https://docs.recall.ai)** meeting bots. Recall runs real meeting clients that join through each platform's supported guest/bot path. That is the only practical way to put a notetaker into *customer-hosted* meetings, where your own Zoom account or Teams tenant APIs have no access.

## Identity & transparency (non-negotiable)

- The bot joins as **"SE Copilot Notetaker"** (configurable, but the name must identify it as an AI notetaker — validated server-side). It never uses an SE's name.
- When it joins, it posts the team's join message in meeting chat (Settings → Team → *Message posted in meeting chat*).
- It waits in the Zoom waiting room or Teams lobby like any guest. If nobody admits it within 15 minutes, it gives up and the meeting shows *Meeting capture unavailable: The notetaker was never admitted…*
- If the Zoom host declines the recording-permission request, the bot leaves and capture is unavailable. Nothing is bypassed.
- Recordings and transcripts are processed under your agreement with Recall. Check your organization's consent requirements — see [privacy.md](../privacy.md).

## 1. Recall.ai account

1. Create a workspace in the region you want data processed in (US East, US West, EU Central or AP Northeast). API keys only work in their own region.
2. Create an API key and set `RECALL_API_KEY` and `RECALL_API_BASE_URL` (e.g. `https://us-east-1.recall.ai`).
3. Webhooks: add an endpoint `https://<your-app>/api/webhooks/recall`, subscribe to **bot status change** events (`bot.*`) and **transcript** events (`transcript.done`, `transcript.failed`). Copy the signing secret (`whsec_…`) into `RECALL_WEBHOOK_SECRET`.
   - The endpoint verifies the signature (HMAC-SHA256 over `id.timestamp.body`) and rejects deliveries more than 5 minutes old.
   - Local development needs a public tunnel (e.g. `ngrok http 3000`) to receive webhooks.

## 2. Transcript provider

`RECALL_TRANSCRIPT_PROVIDER`:

| Value | Cost | Works when | Trade-offs |
|---|---|---|---|
| `meeting_captions` (default) | No extra Recall charge | The platform's captions are enabled (Zoom: account/host must allow captions; Teams: business accounts) | Language follows the meeting; caption-segment timestamps only. If the host disabled captions, the transcript fails and SE Copilot reports why |
| `recallai_streaming` | Billed by Recall | Always | Better accuracy, independent of the host's caption settings |

## 3. Platform notes

### Zoom

- Supported: regular meetings (`/j/`), personal rooms (`/my/`), ZoomGov links are detected. Not supported by bots: Zoom webinars Q&A, OnZoom, meetings with web join disabled or end-to-end encryption enabled.
- **OBF tokens (Zoom policy since 2 March 2026):** Zoom requires Meeting SDK apps that join meetings hosted by *external* accounts to present an "on behalf of" token from a signed-in user who is in the meeting. Recall supports this through a `zoom.obf_token_url` callback. SE Copilot does **not** implement that callback yet. Confirm with Recall whether your workspace needs it for external customer meetings. If so, that is the next integration step: an endpoint that mints an OBF token for the assigned SE.

### Microsoft Teams

- The bot joins anonymously and waits in the lobby unless the organizer lets everyone bypass it.
- Meetings that block anonymous users can't be joined (the meeting shows the reason). Live events, town halls, registration-required meetings and breakout rooms are not supported.

## 4. How joining is scheduled

- Every eligible meeting gets a bot with `join_at = start − join offset` (1 minute by default; 1/2/5 configurable).
- Reschedules and link changes cancel the old bot and schedule a new one; cancellations withdraw it.
- Meeting runs long: the bot stays until everyone leaves. Meeting ends early: the bot leaves with the last participant. Meeting starts late: the bot waits up to 15 minutes for someone to join.
- If no transcript has arrived 60 minutes after the scheduled end, the meeting is marked *capture unavailable* (a safety net for lost webhooks).

## 5. Verify

1. **Integrations** page: Recall API key ✅, status webhook ✅.
2. Create a test Zoom (or Teams) meeting yourself, add it in SE Copilot with the link, and start the meeting. Within a minute "SE Copilot Notetaker" should be in the waiting room/lobby. Admit it.
3. Talk briefly and end the meeting. The meeting should move through Joining → Capturing → Processing. The transcript appears on the Transcript tab, followed by the analysis and MOM (if AI is configured).
4. **Admin → Notetaker** shows every bot session, its last provider event and the readable failure reason.

## Zoom cloud-recording fallback

Optional, and only for meetings **hosted in your own Zoom account** that the notetaker did not attend. Configure a Zoom Server-to-Server OAuth app (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`), subscribe its webhook to `meeting.started`, `meeting.ended`, `recording.completed` at `https://<your-app>/api/webhooks/zoom` (`ZOOM_WEBHOOK_SECRET_TOKEN`), and set `OPENAI_API_KEY` for Whisper speech-to-text plus `STORAGE_*` for S3-compatible storage. When a notetaker covered the meeting, the cloud recording is not transcribed again.
