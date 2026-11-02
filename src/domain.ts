import { DateTime } from 'luxon';

export function isOwner(userId: number | undefined, ownerId: bigint): boolean {
  return userId !== undefined && BigInt(userId) === ownerId;
}

export function shouldRouteToReplySession(isCommand: boolean, hasActiveSession: boolean, hasFlow: boolean): boolean {
  return !isCommand && hasActiveSession && !hasFlow;
}

export function parseLocalDateTime(input: string, timezone: string): Date | null {
  const value = DateTime.fromFormat(input.trim(), 'yyyy-MM-dd HH:mm', { zone: timezone, setZone: true });
  if (!value.isValid) return null;
  return value.toJSDate();
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function reminderAt(dueAt: Date | null): Date | null {
  return dueAt ? new Date(dueAt.getTime() - 15 * 60 * 1000) : null;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
