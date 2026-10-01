# Microsoft 365 setup (sign-in, team calendar, sending as the DL)

SE Copilot uses **one Entra ID app registration** for three things:

1. **Sign-in** for SEs (delegated, OpenID Connect).
2. **Reading the team meeting source** — the calendar the team's invites land in (application permission).
3. **Sending customer follow-ups as the Team DL** (application permission).

## 1. Decide where meetings are read from (TeamMeetingSource)

A distribution list has **no calendar**. Pick the mailbox/calendar the DL's invites actually reach:

| Source type | When to use | Notes |
|---|---|---|
| **Shared mailbox** (recommended) | Add a shared mailbox (e.g. `se-meetings@company.com`) as a member of the DL, so every invite to the DL lands in its calendar | Turn on auto-accept or at least auto-process of meeting requests so events appear in the calendar |
| Forwarded-invite mailbox | SEs forward customer invites to a team mailbox | Same as shared mailbox; forwarding an invite creates the event in the mailbox's calendar |
| Delegated user calendar | A coordinator's own calendar holds all team meetings | Reads that one user's calendar |
| Microsoft 365 group calendar | The team uses a Microsoft 365 group | App-only access to group calendars is limited in Graph; if sync reports 403, use a shared mailbox instead |

Add the source in **Settings → Team → Meeting sources** (or via `TEAM_MEETING_SOURCE_MAILBOX` at seed time).

## 2. Register the app

Entra admin center → App registrations → New registration.

- Supported account types: *This organizational directory only*.
- Redirect URI (Web): `https://<your-app>/api/auth/callback/azure-ad` (and `http://localhost:3000/api/auth/callback/azure-ad` for development).
- Certificates & secrets → new client secret.

Set `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`.

### API permissions (Microsoft Graph)

| Type | Permission | Why |
|---|---|---|
| Delegated | `openid`, `profile`, `email`, `User.Read` | SE sign-in |
| Application | `Calendars.Read` | Read events (including the body, which is where Zoom links live) from the source mailbox |
| Application | `Mail.Send` | Send the follow-up through the sending mailbox |
| Application | `Mail.ReadBasic.All` | Find the original invitation by subject, so the follow-up can reply on that thread (optional — without it, follow-ups are new `Re:` messages) |

Grant admin consent.

## 3. Restrict the app to the team mailboxes (required)

Application permissions apply to **every mailbox in the tenant** until you scope them. Scope them to the source mailbox and the sending mailbox only.

**Preferred: RBAC for Applications in Exchange Online**

```powershell
Connect-ExchangeOnline
New-ServicePrincipal -AppId <MICROSOFT_CLIENT_ID> -ObjectId <enterprise-app-object-id> -DisplayName "SE Copilot"
New-ManagementScope -Name "SE Copilot mailboxes" -RecipientRestrictionFilter "MemberOfGroup -eq 'CN=SE Copilot Mailboxes,...'"
New-ManagementRoleAssignment -App <MICROSOFT_CLIENT_ID> -Role "Application Calendars.Read" -CustomResourceScope "SE Copilot mailboxes"
New-ManagementRoleAssignment -App <MICROSOFT_CLIENT_ID> -Role "Application Mail.Send"     -CustomResourceScope "SE Copilot mailboxes"
New-ManagementRoleAssignment -App <MICROSOFT_CLIENT_ID> -Role "Application Mail.ReadBasic" -CustomResourceScope "SE Copilot mailboxes"
```

When using RBAC for Applications, grant the permissions through Exchange instead of tenant-wide Graph consent — see Microsoft's "Role Based Access Control for Applications in Exchange Online".

**Alternative: Application Access Policy** (older mechanism)

```powershell
New-ApplicationAccessPolicy -AppId <MICROSOFT_CLIENT_ID> -PolicyScopeGroupId se-copilot-mailboxes@company.com -AccessRight RestrictAccess -Description "SE Copilot"
Test-ApplicationAccessPolicy -AppId <MICROSOFT_CLIENT_ID> -Identity se-meetings@company.com
```

## 4. Sending as the Team DL

Customer follow-ups are sent **through** a licensed or shared mailbox (`senderMailbox`, e.g. `se-copilot@company.com`), and the visible **From** is the DL (`teamDlAddress`). That requires *Send As* on the DL:

```powershell
Add-RecipientPermission -Identity se-team@company.com -Trustee se-copilot@company.com -AccessRights SendAs
```

If the sending mailbox and the DL are the same address, no extra permission is needed. Without Send As, Exchange rejects the send. SE Copilot shows the failure and **does not** fall back to sending from the mailbox under a different From.

Configure both addresses in **Settings → Team**.

## 5. Verify

1. **Integrations** page: "Microsoft Graph app credentials" ✅.
2. Settings → Team → Meeting sources → **Sync now**. The source should show "Synced N events". An error here is the raw Graph message (403 = permission or scoping, 404 = wrong mailbox).
3. Send a test invite with a Zoom link to the DL. It should appear under **Meetings** within the sync interval, with platform, customer and eligibility filled in.
4. Use an internal test meeting (internal attendees only), approve a MOM and send it to yourself. Check the From address and that it threaded on the invite.
