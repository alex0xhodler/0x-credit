import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/space-grotesk/300.css'
import '@fontsource/space-grotesk/400.css'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/league-gothic/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
