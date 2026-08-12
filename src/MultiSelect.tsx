import { useEffect, useId, useRef, useState } from 'react'

/**
 * Mehrfachauswahl, die sich beim Anklicken aufklappt.
 *
 * Ein natives <select multiple> waere zwar einfacher, verlangt aber Strg-Klick
 * und zeigt immer nur einen Ausschnitt der Liste. Deshalb ein Knopf mit
 * Klappliste aus Kontrollkaestchen: anklicken, mehrere Haken setzen, fertig.
 */

export interface MultiSelectProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (values: string[]) => void
  /** Text, solange nichts gewaehlt ist */
  placeholder: string
}

export default function MultiSelect({ label, options, selected, onChange, placeholder }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Klick daneben und Escape schliessen die Liste.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const toggle = (option: string) => {
    // Reihenfolge der Vorgabeliste beibehalten, nicht die Klickreihenfolge.
    const next = selected.includes(option)
      ? selected.filter((value) => value !== option)
      : options.filter((value) => value === option || selected.includes(value))
    onChange(next)
  }

  return (
    <div className="multiselect" ref={wrapper}>
      <button
        type="button"
        className={`multiselect-field${selected.length === 0 ? ' is-empty' : ''}`}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="multiselect-value">{selected.length > 0 ? selected.join(', ') : placeholder}</span>
        <span className="multiselect-arrow" aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="multiselect-list" id={listId} role="group" aria-label={label}>
          {options.map((option) => (
            <label key={option} className="multiselect-option">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span>{option}</span>
            </label>
          ))}
          <div className="multiselect-footer">
            <button type="button" className="btn-inline" onClick={() => onChange([])} disabled={selected.length === 0}>
              Auswahl leeren
            </button>
            <button type="button" className="btn-inline" onClick={() => setOpen(false)}>
              Fertig
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
