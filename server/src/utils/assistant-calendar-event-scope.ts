export interface AssistantCalendarEventTargetCandidate {
  targetTitle: string;
  targetDate: string;
  targetStartTime: string | null;
}

export interface AssistantCalendarEventLookupRow {
  id: string;
  title: string;
  date: string;
  startTime: string | null;
}

export function comparableAssistantCalendarEventTitle(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase();
}

export function matchAssistantCalendarEvents<T extends AssistantCalendarEventLookupRow>(
  rows: readonly T[],
  target: AssistantCalendarEventTargetCandidate
): T[] {
  const title = comparableAssistantCalendarEventTitle(target.targetTitle);
  return rows.filter(
    (row) =>
      comparableAssistantCalendarEventTitle(row.title) === title &&
      row.date === target.targetDate &&
      row.startTime === target.targetStartTime
  );
}
