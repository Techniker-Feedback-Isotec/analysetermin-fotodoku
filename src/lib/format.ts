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

/** Datum fuer Dateinamen, deutsche Schreibweise: "04.08.2026". */
export function fileDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${d}.${m}.${y}`
}

/** z. B. "1:23 Min." oder "48 Sek." */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return `${total} Sek.`
  const min = Math.floor(total / 60)
  const rest = String(total % 60).padStart(2, '0')
  return `${min}:${rest} Min.`
}

export function formatPercent(value: number): string {
  return `${percentOf(value)} %`
}

/**
 * Breitenangabe fuer CSS: "44%" ohne Leerzeichen. Mit dem Leerzeichen der
 * deutschen Schreibweise waere es ungueltiges CSS - der Balken bliebe dann
 * stumm auf voller Breite stehen.
 */
export function percentWidth(value: number): string {
  return `${percentOf(value)}%`
}

function percentOf(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100)
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
