import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { Device } from './types'
import { useNetwork } from './context/networkContext'
import Navbar, { type NavPage } from './components/layout/Navbar'
import FloorPlanPage from './pages/FloorPlanPage'
import styles from './App.module.css'

// Lazy-loaded pages and secondary modals for bundle optimization
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'))
const DeviceListPage = lazy(() => import('./pages/DeviceListPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))

const DeviceInfoModal = lazy(() => import('./components/detail/DeviceInfoModal'))
const GlobalSearch = lazy(() => import('./components/layout/GlobalSearch'))

type Page = NavPage | 'detail'

function parseRoute(): { page: Page; deviceId: string | null; floor: 1 | 2 } {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [routePath, queryString] = hash.split('?')
  const params = new URLSearchParams(queryString || '')

  let page: Page = 'floor'
  let deviceId: string | null = null
  let floor: 1 | 2 = 1

  // Read saved floor from localStorage
  const savedFloor = localStorage.getItem('netmonitor_floor')
  if (savedFloor === '2') floor = 2

  if (['floor', 'list', 'reports'].includes(routePath)) {
    page = routePath as Page
  } else if (routePath === 'detail') {
    page = 'detail'
    deviceId = params.get('id') || localStorage.getItem('netmonitor_selected_device_id')
  } else {
    const savedPage = localStorage.getItem('netmonitor_page') as Page | null
    if (savedPage && ['floor', 'list', 'reports', 'detail'].includes(savedPage)) {
      page = savedPage
      if (page === 'detail') {
        deviceId = localStorage.getItem('netmonitor_selected_device_id')
      }
    }
  }

  if (params.get('floor') === '2') floor = 2
  else if (params.get('floor') === '1') floor = 1

  return { page, deviceId, floor }
}

export default function App() {
  const { t } = useTranslation()
  const { devices, error, selectedDevice, selectDevice, retryDevices } = useNetwork()

  const initialRoute = useMemo(() => parseRoute(), [])
  const [page, setPage] = useState<Page>(initialRoute.page)
  const [currentFloor, setCurrentFloor] = useState<1 | 2>(initialRoute.floor)
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(initialRoute.deviceId)
  const [infoDeviceId, setInfoDeviceId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  const infoDevice = infoDeviceId
    ? devices.find(d => d.id === infoDeviceId) ?? null
    : null

  // Restore device selection when devices list loads
  useEffect(() => {
    if (pendingDeviceId && devices.length > 0) {
      const match = devices.find(d => d.id === pendingDeviceId)
      if (match) {
        selectDevice(match.id)
      }
    }
  }, [devices, pendingDeviceId, selectDevice])

  // Sync with browser back/forward or hash changes
  useEffect(() => {
    function onHashChange() {
      const r = parseRoute()
      setPage(r.page)
      if (r.floor !== currentFloor) {
        setCurrentFloor(r.floor)
      }
      if (r.page === 'detail') {
        if (r.deviceId) {
          setPendingDeviceId(r.deviceId)
          selectDevice(r.deviceId)
        }
      } else {
        selectDevice(null)
      }
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [currentFloor, selectDevice])

  // Ctrl+K / Cmd+K → เปิด-ปิด global search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleDeviceClick(device: Device) {
    selectDevice(device.id)
    setPendingDeviceId(device.id)
    setPage('detail')
    localStorage.setItem('netmonitor_page', 'detail')
    localStorage.setItem('netmonitor_selected_device_id', device.id)
    window.location.hash = `#/detail?id=${device.id}`
  }

  function handleNavigate(target: Page) {
    setPage(target)
    localStorage.setItem('netmonitor_page', target)
    if (target !== 'detail') {
      selectDevice(null)
      setPendingDeviceId(null)
      localStorage.removeItem('netmonitor_selected_device_id')
      window.location.hash = `#/${target}`
    }
  }

  function handleFloorChange(floor: 1 | 2) {
    setCurrentFloor(floor)
    localStorage.setItem('netmonitor_floor', String(floor))
  }

  function handleNavigateFloor(floor: 1 | 2) {
    handleFloorChange(floor)
    handleNavigate('floor')
  }

  function openDeviceInfo(device: Device) {
    setInfoDeviceId(device.id)
  }

  return (
    <div className={styles.app}>
      <Navbar
        activePage={page}
        devices={devices}
        onNavigate={handleNavigate}
        onOpenSearch={() => setSearchOpen(true)}
      />
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={15} />
            <span>{t(error)}</span>
          </span>
          <button className={styles.errorRetry} onClick={retryDevices}>{t('common.retry')}</button>
        </div>
      )}
      <main className={styles.mainContent}>
        {page === 'floor' && (
          <FloorPlanPage
            onDeviceInfo={openDeviceInfo}
            currentFloor={currentFloor}
            onFloorChange={handleFloorChange}
          />
        )}
        <Suspense fallback={<div className={styles.pageLoading}>{t('common.loading')}</div>}>
          {page === 'detail' && (
            <DeviceDetailPage
              device={selectedDevice}
              onBack={() => handleNavigate('floor')}
              onNavigateDevice={handleDeviceClick}
              onNavigateFloor={handleNavigateFloor}
              onViewAllAlerts={() => handleNavigate('reports')}
            />
          )}
          {page === 'list' && (
            <DeviceListPage onDeviceClick={handleDeviceClick} />
          )}
          {page === 'reports' && (
            <ReportsPage onDeviceInfo={openDeviceInfo} />
          )}


          {/* More-info modal (เปิดได้จากทุกหน้า: pin / alert / global search) */}
          {infoDevice && (
            <DeviceInfoModal
              device={infoDevice}
              onClose={() => setInfoDeviceId(null)}
              onOpenFullDetail={dev => {
                setInfoDeviceId(null)
                handleDeviceClick(dev)
              }}
              onNavigateFloor={floor => {
                setInfoDeviceId(null)
                handleNavigateFloor(floor)
              }}
            />
          )}

          {searchOpen && (
            <GlobalSearch
              devices={devices}
              onClose={() => setSearchOpen(false)}
              onSelect={dev => {
                setSearchOpen(false)
                openDeviceInfo(dev)
              }}
            />
          )}
        </Suspense>
      </main>
    </div>
  )
}
