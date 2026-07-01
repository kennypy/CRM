import { api } from "@/lib/api";

/**
 * Executor for command-bar actions proposed by the NL interface.
 *
 * The NL model emits free-form `action` payloads; we do NOT blindly apply
 * whatever it returns (that would be a prompt-injection write vector). Instead
 * we map a small allowlist of intents to existing, validated REST endpoints and
 * decline anything else honestly. This turns the previously-dead "Confirm"
 * button into real execution for the safe common cases.
 */

interface ActionData {
  action?: string;
  [key: string]: unknown;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export async function executeCommandAction(data: ActionData): Promise<ActionResult> {
  const action = data.action;

  try {
    switch (action) {
      case "create_task": {
        const title = str(data.title) ?? str(data.name);
        if (!title) return { ok: false, message: "Task needs a title." };
        const res = await api.post("/api/v1/tasks", {
          title,
          description: str(data.description) ?? "",
          due_date: str(data.due_date) ?? str(data.dueDate),
          priority: str(data.priority) ?? "medium",
        });
        return res.ok
          ? { ok: true, message: `Task created: ${title}` }
          : { ok: false, message: `Couldn't create task (${res.status}).` };
      }

      case "create_contact": {
        const name = str(data.name) ?? str(data.full_name);
        const email = str(data.email);
        if (!name && !email) return { ok: false, message: "Contact needs a name or email." };
        const res = await api.post("/api/v1/contacts", { name, email });
        return res.ok
          ? { ok: true, message: `Contact created: ${name ?? email}` }
          : { ok: false, message: `Couldn't create contact (${res.status}).` };
      }

      case "log_activity":
      case "create_note": {
        const content = str(data.content) ?? str(data.note) ?? str(data.description);
        if (!content) return { ok: false, message: "Nothing to log." };
        const res = await api.post("/api/v1/activities", {
          type: str(data.type) ?? "note",
          title: str(data.title) ?? "Logged from command bar",
          description: content,
        });
        return res.ok
          ? { ok: true, message: "Activity logged." }
          : { ok: false, message: `Couldn't log activity (${res.status}).` };
      }

      default:
        return {
          ok: false,
          message:
            "This action can't be run automatically yet — open the relevant page to complete it.",
        };
    }
  } catch {
    return { ok: false, message: "Something went wrong running that action." };
  }
}
