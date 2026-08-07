export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes
  let unit = -1
  do {
    value /= 1024
    unit++
  } while (value >= 1024 && unit < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

/** z. B. "Mittwoch, 6. August 2026" */
export function formatDateWeekday(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ms))
}

/** z. B. "06.08.2026" */
export function formatDateShort(ms: number): string {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(ms))
}

export function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/** Entfernt Zeichen, die in Dateinamen nicht erlaubt sind. */
export function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '').trim()
}
