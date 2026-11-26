/** A "usage day" runs 07:00 -> 04:00 the next morning (local time). */
export const DAY_START_HOUR = 7
export const DAY_END_HOUR = 4
export const ACTIVE_HOURS = 21

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local YYYY-MM-DD of the usage day: anything before 04:00 belongs to the previous day. */
export function usageDay(ms: number): string {
  const d = new Date(ms - DAY_END_HOUR * 3_600_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 07:00 local of the usage day containing `ms`. */
export function dayStartMs(ms: number): number {
  const [y, m, d] = usageDay(ms).split('-').map(Number)
  return new Date(y, m - 1, d, DAY_START_HOUR, 0, 0, 0).getTime()
}

/** 04:00 local that starts the usage day containing `ms` (use before 07:00 still counts toward that day). */
export function dayBoundaryMs(ms: number): number {
  const [y, m, d] = usageDay(ms).split('-').map(Number)
  return new Date(y, m - 1, d, DAY_END_HOUR, 0, 0, 0).getTime()
}

/** Hours of [fromMs, toMs] inside the windows [D 07:00, D+1 04:00] over all dates D. */
export function activeHours(fromMs: number, toMs: number): number {
  if (!(toMs > fromMs)) return 0
  const d0 = new Date(fromMs)
  d0.setHours(0, 0, 0, 0)
  d0.setDate(d0.getDate() - 1)
  let total = 0
  for (let d = d0; d.getTime() < toMs; d.setDate(d.getDate() + 1)) {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_START_HOUR).getTime()
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, DAY_END_HOUR).getTime()
    const lo = Math.max(a, fromMs)
    const hi = Math.min(b, toMs)
    if (hi > lo) total += hi - lo
  }
  return total / 3_600_000
}
