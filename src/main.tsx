import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

/**
 * Nachladbare Programmteile (Video, PDF, Sanierungsvorschau) tragen einen Hash
 * im Dateinamen. Wird waehrend der Arbeit eine neue Fassung ausgeliefert, sucht
 * die offene Seite beim naechsten Klick eine Datei, die es unter dem alten
 * Namen nicht mehr gibt. Vite meldet das als "vite:preloadError"; ohne diesen
 * Hinweis stand dort nur "Failed to fetch dynamically imported module"
 * (Yann, 10.09.2026).
 *
 * Nicht von selbst neu laden: Fotos, Videos und Eingaben liegen nur im
 * Speicher dieser Seite und waeren dann weg. Also nur sagen, was los ist.
 */
window.addEventListener('vite:preloadError', (ereignis) => {
  ereignis.preventDefault()
  const balken = document.createElement('div')
  balken.className = 'neue-fassung'
  balken.innerHTML =
    '<span>Es wurde gerade eine neue Fassung veröffentlicht. Bitte die Seite neu laden. ' +
    'Achtung: geladene Fotos und Eingaben gehen dabei verloren.</span>'
  const knopf = document.createElement('button')
  knopf.type = 'button'
  knopf.textContent = 'Neu laden'
  knopf.onclick = () => window.location.reload()
  balken.append(knopf)
  document.body.append(balken)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
