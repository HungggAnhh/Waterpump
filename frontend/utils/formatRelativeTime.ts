// frontend/utils/formatRelativeTime.ts

/**
 * Formats a date string or object to a user-friendly Vietnamese relative time string.
 * Examples: "Vừa xong", "5 phút trước", "Hôm qua", "27/05/2026"
 */
export function formatRelativeTime(dateInput: string | Date | null | undefined): string {
  if (!dateInput) return '';
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);

  // If timestamp is in the future (due to slight clock mismatch), show "Vừa xong"
  if (diffSecs < 15) {
    return 'Vừa xong';
  }
  if (diffSecs < 60) {
    return `${diffSecs} giây trước`;
  }
  if (diffMins < 60) {
    return `${diffMins} phút trước`;
  }
  if (diffHours < 24) {
    return `${diffHours} giờ trước`;
  }

  // Check if it was yesterday
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Hôm qua';
  }

  // Fallback to absolute date
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
