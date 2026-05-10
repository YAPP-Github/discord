import { google, type calendar_v3 } from "googleapis";
import { config } from "../../config.js";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string; // ISO
  end: string; // ISO
  meet_url: string | null;
}

let _client: calendar_v3.Calendar | null = null;

function client(): calendar_v3.Calendar {
  if (_client) return _client;
  if (!config.google.serviceAccountJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON not configured");
  }
  const credentials = JSON.parse(config.google.serviceAccountJson);
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  _client = google.calendar({ version: "v3", auth });
  return _client;
}

// Test seam.
export function _setClient(c: calendar_v3.Calendar | null): void {
  _client = c;
}

export async function listEvents(
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  const res = await client().events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items ?? []).map(toEvent).filter((e) => e !== null);
}

function toEvent(raw: calendar_v3.Schema$Event): CalendarEvent | null {
  if (!raw.id) return null;
  const start = raw.start?.dateTime ?? raw.start?.date ?? null;
  const end = raw.end?.dateTime ?? raw.end?.date ?? null;
  if (!start || !end) return null;
  const meet =
    raw.conferenceData?.entryPoints?.find((ep) => ep.uri)?.uri ??
    raw.hangoutLink ??
    null;
  return {
    id: raw.id,
    summary: raw.summary ?? "(제목 없음)",
    start,
    end,
    meet_url: meet,
  };
}
