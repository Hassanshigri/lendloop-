/** Today's calendar date in UTC as YYYY-MM-DD. Loan dates are compared as strings. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
