# Engineering Notes

## Outreach `send_email` integration (open)

The workflow-engine `send_email` action and the scheduled-reports email
delivery now call the correct outreach route (`POST /email/send`), but the
payload does not yet satisfy outreach's `SendEmailSchema`:

- `to` must be an array of addresses,
- the body field is `bodyText` (HTML is not accepted on this route),
- `provider` (`gmail` | `outlook`) is required and must correspond to a
  connected mailbox for the sending user — a system-triggered email has no
  obvious sending identity today.

**When outreach system-sending is integrated** (a tenant-level default sending
mailbox or a transactional provider), update:

- `services/api-gateway/src/workers/workflow-engine.ts` → `send_email` action
- `services/api-gateway/src/workers/scheduled-reports.ts` → report delivery

to pass the chosen provider/identity, and remove this note.
