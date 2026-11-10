import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { DeviceType, DiscoveredDevice, LocalNetworkInfo } from '../../types'
import { scanNetwork, fetchLocalNetworkInfo, checkBackendHealth } from '../../services/api'
import { getStoredRooms } from '../../services/roomStore'
import { useNetwork } from '../../context/networkContext'
import { useToast } from '../ui/toast-context'
import Modal from '../ui/Modal'
import {
  Search,
  Lock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Globe,
  Radio,
  Timer,
  Check,
  Download,
  Loader2,
  Tag,
  Navigation,
  MapPin,
  Building2,
} from 'lucide-react'
import styles from './NetworkScanModal.module.css'

interface Props {
  open: boolean
  defaultFloor?: 1 | 2
  onClose: () => void
}

const QUICK_CIDRS = [
  '192.168.22.0/24',
  '192.168.1.0/24',
  '10.0.0.0/24',
  '10.1.0.0/24',
  '127.0.0.1/32',
]

const DEVICE_TYPES: DeviceType[] = ['switch', 'router', 'ap', 'server']

export default function NetworkScanModal({ open, defaultFloor = 1, onClose }: Props) {
  const { t } = useTranslation()
  const { importDiscovered } = useNetwork()
  const { showToast } = useToast()

  const [backendStatus, setBackendStatus] = useState<{ online: boolean; db: boolean } | null>(null)
  const [netInfo, setNetInfo] = useState<LocalNetworkInfo | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [customCidr, setCustomCidr] = useState('')
  const [community, setCommunity] = useState('')
  const [floorSplitThreshold, setFloorSplitThreshold] = useState<number>(120)
  const [scanning, setScanning] = useState(false)
  const [scanDuration, setScanDuration] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<DiscoveredDevice[]>([])
  const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set())
  const [deviceFloors, setDeviceFloors] = useState<Record<string, 1 | 2>>({})
  const [deviceRooms, setDeviceRooms] = useState<Record<string, string>>({})
  const [deviceDtypes, setDeviceDtypes] = useState<Record<string, DeviceType>>({})
  const [customNames, setCustomNames] = useState<Record<string, string>>({})

  // ดึงผังห้องที่ผู้ใช้ได้ทำการ set ไว้ในระบบเท่านั้น
  const roomsF1 = useMemo(() => (open ? getStoredRooms(1) : []), [open])
  const roomsF2 = useMemo(() => (open ? getStoredRooms(2) : []), [open])

  useEffect(() => {
    if (open) {
      checkBackendHealth().then(status => setBackendStatus(status))
      fetchLocalNetworkInfo().then(info => {
        setNetInfo(info)
        setCustomCidr(info.detected_subnet)
      })
    }
  }, [open])

  async function handleScan(useCustom = false) {
    if (scanning) return
    setScanning(true)
    setResults([])
    setSelectedIps(new Set())
    setScanDuration(null)
    setCustomNames({})
    setDeviceRooms({})
    
    const targetCidr = useCustom && customCidr.trim() ? customCidr.trim() : 'auto'
    const t0 = performance.now()

    try {
      const found = await scanNetwork(targetCidr, community.trim(), 161, undefined, floorSplitThreshold)
      const durationSec = Math.round((performance.now() - t0) / 100) / 10
      setScanDuration(durationSec)
      setResults(found)
      
      const newIps = new Set<string>()
      const initialFloors: Record<string, 1 | 2> = {}
      const initialRooms: Record<string, string> = {}
      const initialDtypes: Record<string, DeviceType> = {}
      for (const d of found) {
        if (!d.already_exists) {
          newIps.add(d.ip)
        }
        const assignedFloor = (d.detected_floor as 1 | 2) || defaultFloor
        initialFloors[d.ip] = assignedFloor
        initialDtypes[d.ip] = d.dtype

        // ให้ดึงและจับคู่จากข้อมูลห้องที่ทำการ set ไว้เท่านั้น
        const availableRooms = assignedFloor === 1 ? roomsF1 : roomsF2
        const matched = availableRooms.find(r => r.label === d.target_room)
        if (matched) {
          initialRooms[d.ip] = matched.label
        } else if (availableRooms.length > 0) {
          initialRooms[d.ip] = availableRooms[0].label
        } else {
          initialRooms[d.ip] = ''
        }
      }
      setSelectedIps(newIps)
      setDeviceFloors(initialFloors)
      setDeviceRooms(initialRooms)
      setDeviceDtypes(initialDtypes)
      
      const newCount = found.filter(d => !d.already_exists).length
      if (found.length === 0) {
        showToast(t('scan.noDevicesFound'), 'info')
      } else {
        showToast(t('scan.scanCompleted', { count: found.length }) + ` (${newCount} ใหม่, ${durationSec}s)`, 'success')
      }
    } catch {
      showToast(t('common.error'), 'error')
    } finally {
      setScanning(false)
    }
  }

  function handleToggle(ip: string) {
    setSelectedIps(prev => {
      const next = new Set(prev)
      if (next.has(ip)) next.delete(ip)
      else next.add(ip)
      return next
    })
  }

  function handleToggleAll() {
    const selectable = results.filter(r => !r.already_exists)
    if (selectedIps.size >= selectable.length) {
      setSelectedIps(new Set())
    } else {
      setSelectedIps(new Set(selectable.map(r => r.ip)))
    }
  }

  async function handleImport() {
    const toImport = results.filter(r => selectedIps.has(r.ip) && !r.already_exists)
    if (toImport.length === 0 || importing) return

    setImporting(true)
    try {
      const items = toImport.map(d => ({
        name: customNames[d.ip]?.trim() || d.hostname || `DEV-${d.ip.replace(/\./g, '-')}`,
        ip: d.ip,
        dtype: deviceDtypes[d.ip] ?? d.dtype,
        floor: deviceFloors[d.ip] ?? (d.detected_floor as 1 | 2) ?? defaultFloor,
        x: d.preview_x,
        y: d.preview_y,
        model: d.sys_descr ? d.sys_descr.slice(0, 50) : undefined,
        community: d.community || (community.trim() ? community.trim().split(/[,;\s]+/)[0].trim() : undefined),
        latitude: d.latitude,
        longitude: d.longitude,
        altitude: d.altitude,
        target_room: deviceRooms[d.ip] || undefined,
      }))
      const created = await importDiscovered(items)
      showToast(t('scan.importSuccess', { count: created.length }), 'success')
      onClose()
    } catch {
      showToast(t('common.error'), 'error')
    } finally {
      setImporting(false)
    }
  }

  const unimportedCount = results.filter(r => !r.already_exists).length

  return (
    <Modal open={open} title={t('scan.title')} onClose={onClose} width={780}>
      <div className={styles.modalBody}>
        {/* Backend offline warning banner */}
        {backendStatus && !backendStatus.online && (
          <div className={styles.healthBanner}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>{t('scan.backendOffline')}</strong> {t('scan.backendOfflineNotice')}
            </div>
          </div>
        )}

        {/* Zero-Config Auto Scan Card */}
        <div className={styles.autoCard}>
          <div className={styles.autoInfo}>
            <div className={styles.autoTitle} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Globe size={16} />
              <span>{t('scan.autoDetectedSubnet')}: {netInfo?.detected_subnet ?? t('scan.detecting')}</span>
              {backendStatus?.online ? (
                <span className={styles.badgeOk} style={{ fontSize: 12, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                  Backend Online
                </span>
              ) : (
                <span className={styles.badgePing} style={{ fontSize: 12, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                  Local Mode
                </span>
              )}
            </div>
            <div className={styles.autoSub}>
              {t('scan.hostIp')}: {netInfo?.local_ip ?? '192.168.22.60'} · {t('scan.gateway')}: {netInfo?.gateway ?? '192.168.22.254'}
            </div>
            {netInfo?.wifi_ssid && (
              <div className={styles.wifiInfo}>
                <span>{t('scan.wifiSignal')}:</span>
                <strong>{netInfo.wifi_ssid}</strong>
                <span>(BSSID: {netInfo.wifi_bssid || '—'}, {t('scan.signal')}: {netInfo.wifi_signal || '100%'})</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              className={styles.primaryScanBtn}
              onClick={() => handleScan(showAdvanced)}
              disabled={scanning}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              {scanning ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  <span>{t('scan.scanning')}</span>
                </span>
              ) : (
                <>
                  <Search size={14} />
                  <span>{t('scan.autoScanBtn')}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Settings */}
        <div>
          <button
            type="button"
            className={styles.advancedLink}
            onClick={() => setShowAdvanced(prev => !prev)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{t('scan.advancedSettings')}</span>
          </button>
        </div>

        {showAdvanced && (
          <div className={styles.advancedControls}>
            <div className={styles.row}>
              <div className={styles.field} style={{ flex: 2 }}>
                <label className={styles.label}>{t('scan.subnetLabel')}</label>
                <input
                  className={styles.input}
                  value={customCidr}
                  onChange={e => setCustomCidr(e.target.value)}
                  placeholder="192.168.22.0/24"
                  disabled={scanning}
                />
              </div>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label}>{t('scan.communityLabel')}</label>
                <input
                  className={styles.input}
                  value={community}
                  onChange={e => setCommunity(e.target.value)}
                  placeholder="e.g. cisco, monitor, read (blank = auto)"
                  disabled={scanning}
                />
              </div>
              <div className={styles.field} style={{ flex: 1 }}>
                <label className={styles.label}>{t('scan.floorSplitRule')}</label>
                <input
                  className={styles.input}
                  type="number"
                  value={floorSplitThreshold}
                  onChange={e => setFloorSplitThreshold(Number(e.target.value) || 120)}
                  placeholder="120"
                  disabled={scanning}
                />
              </div>
              <button
                className={styles.primaryScanBtn}
                style={{ padding: '8px 14px', height: 38 }}
                onClick={() => handleScan(true)}
                disabled={scanning}
              >
                {t('scan.startScan')}
              </button>
            </div>

            <div className={styles.chips}>
              <span className={styles.chipLabel}>{t('scan.presets')}:</span>
              {QUICK_CIDRS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={styles.chip}
                  onClick={() => setCustomCidr(c)}
                  disabled={scanning}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Loading Radar */}
        {scanning && (
          <div className={styles.radarLoader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Radio size={16} />
            <span>{t('scan.scanningNotice', { cidr: showAdvanced && customCidr ? customCidr : netInfo?.detected_subnet ?? '192.168.22.0/24' })}</span>
          </div>
        )}

        {/* Scan Results Meta */}
        {!scanning && results.length > 0 && (
          <div className={styles.resultsMeta}>
            <div>
              {t('scan.responsiveStats', { total: results.length, unimported: unimportedCount, existing: results.length - unimportedCount })}
            </div>
            {scanDuration !== null && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Timer size={13} />
                <span>{t('scan.scanDuration', { duration: scanDuration })}</span>
              </div>
            )}
          </div>
        )}

        {/* Results Table */}
        {!scanning && results.length > 0 && (
          <div className={styles.resultsArea}>
            <table className={styles.resultsTable}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={
                        selectedIps.size > 0 &&
                        selectedIps.size === unimportedCount
                      }
                      onChange={handleToggleAll}
                      disabled={unimportedCount === 0}
                    />
                  </th>
                  <th>IP Address</th>
                  <th>{t('scan.thDeviceName')}</th>
                  <th>{t('scan.thType')}</th>
                  <th>{t('scan.thFloor')}</th>
                  <th>{t('scan.thTargetZone')}</th>
                  <th>{t('scan.thStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map(d => {
                  const exists = d.already_exists
                  const isChecked = selectedIps.has(d.ip)
                  return (
                    <tr key={d.ip} className={exists ? styles.rowExists : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isChecked && !exists}
                          disabled={exists}
                          onChange={() => handleToggle(d.ip)}
                          title={exists ? t('scan.alreadyInSystemTitle') : t('scan.selectToImportTitle')}
                        />
                      </td>
                      <td>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)', fontSize: 13 }}>{d.ip}</div>
                        {d.mac && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            MAC: {d.mac}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="text"
                          className={styles.nameInput}
                          value={customNames[d.ip] ?? d.hostname ?? ''}
                          disabled={exists}
                          placeholder={d.hostname || t('scan.specifyDeviceName')}
                          onChange={e =>
                            setCustomNames(prev => ({
                              ...prev,
                              [d.ip]: e.target.value,
                            }))
                          }
                          title={t('scan.clickToEditNameTitle')}
                        />
                        {d.sys_descr && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                            {d.sys_descr}
                          </div>
                        )}
                      </td>
                      <td>
                        <select
                          className={styles.selectSmall}
                          value={deviceDtypes[d.ip] ?? d.dtype}
                          disabled={exists}
                          onChange={e =>
                            setDeviceDtypes(prev => ({
                              ...prev,
                              [d.ip]: e.target.value as DeviceType,
                            }))
                          }
                        >
                          {DEVICE_TYPES.map(type => (
                            <option key={type} value={type}>
                              {t(`deviceType.${type}`)}
                            </option>
                          ))}
                        </select>
                        <div style={{ marginTop: 3 }}>
                          <span
                            className={d.confidence && d.confidence >= 90 ? styles.badgeOk : styles.badgePing}
                            style={{ fontSize: 9, padding: '1px 5px', cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                            title={d.reason || t('scan.analyzedFromTelemetry')}
                          >
                            <Check size={10} />
                            <span>{d.confidence ? `${d.confidence}%` : 'Auto'}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <select
                          className={styles.selectSmall}
                          value={deviceFloors[d.ip] ?? d.detected_floor ?? defaultFloor}
                          disabled={exists}
                          onChange={e => {
                            const newFloor = Number(e.target.value) as 1 | 2
                            setDeviceFloors(prev => ({
                              ...prev,
                              [d.ip]: newFloor,
                            }))
                            const targetRooms = newFloor === 1 ? roomsF1 : roomsF2
                            setDeviceRooms(prev => ({
                              ...prev,
                              [d.ip]: targetRooms.length > 0 ? targetRooms[0].label : '',
                            }))
                          }}
                        >
                          <option value={1}>{t('search.floor', { floor: 1 })}</option>
                          <option value={2}>{t('search.floor', { floor: 2 })}</option>
                        </select>
                        {d.floor_reason && (
                          <div
                            style={{
                              fontSize: 9,
                              color: /GPS|Alt|Tag/i.test(d.floor_reason) ? 'var(--accent-primary)' : 'var(--text-muted)',
                              marginTop: 2,
                              maxWidth: 160,
                              lineHeight: 1.25,
                              wordBreak: 'break-word',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title={d.floor_reason}
                          >
                            {/Tag/i.test(d.floor_reason) ? (
                              <Tag size={10} style={{ flexShrink: 0 }} />
                            ) : /GPS|Alt/i.test(d.floor_reason) ? (
                              <Navigation size={10} style={{ flexShrink: 0 }} />
                            ) : /พิกัด|ห้อง/i.test(d.floor_reason) ? (
                              <MapPin size={10} style={{ flexShrink: 0 }} />
                            ) : /Core/i.test(d.floor_reason) ? (
                              <Building2 size={10} style={{ flexShrink: 0 }} />
                            ) : null}
                            <span>{d.floor_reason.replace(/^[🏷🛰📍🏢]\s*/, '')}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {(() => {
                          const currentFl = deviceFloors[d.ip] ?? (d.detected_floor as 1 | 2) ?? defaultFloor
                          const currentRooms = currentFl === 1 ? roomsF1 : roomsF2
                          const currentRoomVal = deviceRooms[d.ip] ?? d.target_room ?? ''

                          if (currentRooms.length === 0) {
                            return (
                              <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontStyle: 'italic', padding: '3px 0' }}>
                                (ไม่มีห้องในชั้นนี้)
                              </div>
                            )
                          }

                          return (
                            <select
                              className={styles.selectSmall}
                              style={{ width: '100%', maxWidth: 160, fontWeight: 500 }}
                              value={currentRoomVal}
                              disabled={exists}
                              onChange={e =>
                                setDeviceRooms(prev => ({
                                  ...prev,
                                  [d.ip]: e.target.value,
                                }))
                              }
                            >
                              {currentRooms.map(r => (
                                <option key={r.label} value={r.label}>
                                  {r.label}
                                </option>
                              ))}
                            </select>
                          )
                        })()}
                        {typeof d.latitude === 'number' && typeof d.longitude === 'number' && (
                          <div style={{ fontSize: 9, color: 'var(--accent-primary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span>{d.gps_source === 'auto_inherited' ? 'Auto' : 'GPS'}</span>
                            <span>{d.latitude.toFixed(4)}, {d.longitude.toFixed(4)}</span>
                            {typeof d.altitude === 'number' && <span>({d.altitude}m)</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        {exists ? (
                          <span className={`${styles.badge} ${styles.badgeLocked}`} title={t('scan.importedLocked')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={11} />
                            <span>{t('scan.alreadyInSystem')}</span>
                          </span>
                        ) : d.snmp_ok ? (
                          <span className={`${styles.badge} ${styles.badgeOk}`} title={`SNMP OK via '${d.community || 'matched'}'`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                            <span>SNMP {d.community ? `(${d.community})` : 'Ready'} ({d.response_time_ms}ms)</span>
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgePing}`} title="ICMP Ping / ARP neighbor active, SNMP unauthenticated" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                            <span>Ping / ARP ({d.response_time_ms}ms)</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!scanning && results.length === 0 && (
          <div className={styles.emptyState}>
            {t('scan.emptyHint')}
          </div>
        )}

        {/* Action bar */}
        <div className={styles.actionsBar}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedIps.size > 0 && t('scan.selectedCount', { count: selectedIps.size })}
          </div>
          <button
            className={styles.importBtn}
            onClick={handleImport}
            disabled={selectedIps.size === 0 || importing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {importing ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                <span>...</span>
              </>
            ) : (
              <>
                <Download size={14} />
                <span>{t('scan.importBtn')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
