import { execFile } from "node:child_process";
import type { TaskType } from "../../utils/types";

/**
 * Calendar and mail go through AppleScript because macOS already owns those apps and
 * this keeps the data local - no Google/Microsoft OAuth tokens in the app.
 * Windows has no equivalent built-in surface, so the tool reports that instead of
 * pretending to work.
 */
export class CalendarEmailTools {
  readonly type: TaskType = "calendar";
  readonly mutatingActions: ReadonlySet<string> = new Set(["create_event", "draft_mail"]);

  private get supported(): boolean {
    return process.platform === "darwin";
  }

  async execute(action: string, args: Record<string, unknown>): Promise<string> {
    if (!this.supported) {
      throw new Error("Calendar and mail automation is only wired up for macOS (AppleScript)");
    }

    switch (action) {
      case "list_events":
        return this.listEvents(Number(args.days ?? 7));
      case "create_event":
        return this.createEvent(String(args.summary ?? ""), String(args.start ?? ""), String(args.end ?? ""), String(args.calendar ?? "Calendar"));
      case "list_mail":
        return this.listMail(Number(args.count ?? 10));
      case "draft_mail":
        return this.draftMail(String(args.to ?? ""), String(args.subject ?? ""), String(args.body ?? ""));
      default:
        throw new Error(`Unknown calendar/email action: ${action}`);
    }
  }

  private async osascript(source: string): Promise<string> {
    return await new Promise((resolve, reject) => {
      execFile("osascript", ["-e", source], { timeout: 30_000, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  private async listEvents(days: number): Promise<string> {
    const script = `
tell Application "Calendar"
  set dayRange to (current date)
  set output to ""
  repeat with cal in calendars
    repeat with e in (every event of cal whose start date >= dayRange and start date < dayRange + ${Math.round(days)} * days)
      set output to output & (name of cal) & " | " & ((start date of e) as string) & " | " & (summary of e) & linefeed
    end repeat
  end repeat
  return output
end tell`;
    const result = await this.osascript(script);
    return result || `No calendar events in the next ${days} days`;
  }

  private async createEvent(summary: string, start: string, end: string, calendarName: string): Promise<string> {
    if (!summary.trim() || !start.trim()) throw new Error("create_event needs a summary and a start date");
    const script = `
tell Application "Calendar"
  set targetCalendar to calendar ${appleScriptQuote(calendarName)}
  set newEvent to make new event at end of events of targetCalendar with properties {summary:${appleScriptQuote(summary)}, start date:date ${appleScriptQuote(start)}${end.trim() ? `, end date:date ${appleScriptQuote(end)}` : ""}}
  return "Created event " & (summary of newEvent) & " on " & ((start date of newEvent) as string)
end tell`;
    return await this.osascript(script);
  }

  private async listMail(count: number): Promise<string> {
    const script = `
tell Application "Mail"
  set output to ""
  repeat with m in (messages of mailbox "INBOX" of account 1 whose read status is false)
    if (count of (every message of mailbox "INBOX" of account 1 whose read status is false)) > ${Math.round(count)} then exit repeat
    set output to output & (date received of m) & " | " & (sender of m) & " | " & (subject of m) & linefeed
  end repeat
  return output
end tell`;
    const result = await this.osascript(script);
    return result || "No unread messages";
  }

  /** Drafts only: the user reviews and sends, so a misread instruction cannot mail anyone. */
  private async draftMail(to: string, subject: string, body: string): Promise<string> {
    if (!to.trim()) throw new Error("draft_mail needs a recipient");
    const script = `
tell Application "Mail"
  make new draft message at end of messages of mailbox "DRAFTS" of account 1 with properties {subject:${appleScriptQuote(subject)}, body:${appleScriptQuote(body)}, recipient:{{{address:${appleScriptQuote(to)}, form name:1, "display name":"${escapeQuotes(to)}"}}}
  return "Draft created for " & ${appleScriptQuote(to)}
end tell`;
    return await this.osascript(script);
  }
}

/** AppleScript string literals: backslash and double quote are the only escapes needed. */
function appleScriptQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeQuotes(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
