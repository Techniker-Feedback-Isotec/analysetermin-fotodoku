import { useCallback, useRef, useState } from 'react'
import { sha256Hex } from './lib/hash'
import { makeThumbnailUrl } from './lib/image'
import { isSupported, prepareImage, type Progress, type TerminPhoto } from './lib/bilder'
import type { ToastFn } from './kunde'

/**
 * Gemeinsamer Bilderstapel von Fotodokumentation und Prinzipskizze.
 *
 * Hochgeladen wird einmal (Wunsch Yann, 08.09.2026): Wer die Fotos vom Termin
 * einliest, hat sie auch auf der Prinzipskizzen-Seite sofort in der Liste und
 * wirft dort nur die heraus, die stoeren. Was eine Seite herausnimmt, bleibt
 * deshalb im Stapel - das Entfernen ist Sache der jeweiligen Seite.
 *
 * Gedreht wird dagegen hier: Ein schief eingelesenes Foto ist auf jeder Seite
 * schief, also gilt die Drehung fuer alle.
 */
export interface Fotostapel {
  fotos: TerminPhoto[]
  fortschritt: Progress | null
  hinzufuegen: (dateien: FileList | File[]) => Promise<void>
  drehen: (id: string) => Promise<void>
}

export function useFotostapel(onToast: ToastFn): Fotostapel {
  const [fotos, setFotos] = useState<TerminPhoto[]>([])
  const [fortschritt, setFortschritt] = useState<Progress | null>(null)
  const fotosRef = useRef(fotos)
  fotosRef.current = fotos

  const hinzufuegen = useCallback(
    async (dateien: FileList | File[]) => {
      const alle = Array.from(dateien)
      alle
        .filter((d) => !isSupported(d))
        .forEach((d) => onToast('error', `Nicht unterstütztes Format: ${d.name}`))
      const brauchbar = alle.filter(isSupported)
      if (brauchbar.length === 0) return

      const bekannteHashes = new Set(fotosRef.current.map((f) => f.hash))
      let ohneExif = 0
      let doppelt = 0

      for (let i = 0; i < brauchbar.length; i++) {
        const datei = brauchbar[i]
        setFortschritt({
          label: `Verarbeite Bild ${i + 1}/${brauchbar.length}: ${datei.name}`,
          done: i,
          total: brauchbar.length,
        })
        try {
          const hash = await sha256Hex(datei)
          const vorbereitet = await prepareImage(datei)
          if (vorbereitet.dateSource === 'file') ohneExif++
          if (bekannteHashes.has(hash)) {
            doppelt++
            onToast('info', `Duplikat erkannt: ${datei.name}`)
          }
          bekannteHashes.add(hash)
          setFotos((bisher) => [...bisher, { ...vorbereitet, hash, id: crypto.randomUUID(), rotation: 0 }])
        } catch (fehler) {
          onToast('error', fehler instanceof Error ? fehler.message : `Fehler bei ${datei.name}`)
        }
      }
      setFortschritt(null)
      if (ohneExif > 0) {
        onToast('info', `Kein EXIF-Datum bei ${ohneExif} Foto(s) gefunden – verwende Dateidatum.`)
      }
      if (doppelt > 0) {
        onToast('info', `${doppelt} Duplikat(e) erkannt – sie sind in der Liste gekennzeichnet.`)
      }
    },
    [onToast],
  )

  /** Foto um 90 Grad im Uhrzeigersinn drehen (Vorschau wird neu erzeugt) */
  const drehen = useCallback(
    async (id: string) => {
      const foto = fotosRef.current.find((f) => f.id === id)
      if (!foto) return
      const rotation = (foto.rotation + 90) % 360
      try {
        const thumbUrl = await makeThumbnailUrl(foto.workingBlob, foto.orientation, 512, rotation)
        setFotos((bisher) =>
          bisher.map((f) => {
            if (f.id !== id) return f
            URL.revokeObjectURL(f.thumbUrl)
            return { ...f, rotation, thumbUrl }
          }),
        )
      } catch {
        onToast('error', `Foto konnte nicht gedreht werden: ${foto.fileName}`)
      }
    },
    [onToast],
  )

  return { fotos, fortschritt, hinzufuegen, drehen }
}
