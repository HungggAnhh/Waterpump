import { formatConversationTime } from './dateTime';

/**
 * Formats a date string or object to a user-friendly Vietnamese relative time string.
 * Proxies to the shared formatConversationTime helper in dateTime.ts.
 */
export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  return formatConversationTime(dateInput);
}
