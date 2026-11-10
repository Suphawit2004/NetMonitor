import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App'
import ToastProvider from './components/ui/Toast'
import SettingsProvider from './context/SettingsProvider'
import SimulationProvider from './context/SimulationProvider'
import NetworkProvider from './context/NetworkProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <SettingsProvider>
        <SimulationProvider>
          <NetworkProvider>
            <App />
          </NetworkProvider>
        </SimulationProvider>
      </SettingsProvider>
    </ToastProvider>
  </StrictMode>,
)
