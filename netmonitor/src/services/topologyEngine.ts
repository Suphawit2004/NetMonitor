import type {
  BlastRadiusReport,
  Device,
  DeviceImpactDetail,
  ImpactState,
  LinkImpactState,
  SpofCandidate,
  TopologyLink,
} from '../types'

function dist(a: Device, b: Device): number {
  const floorPenalty = a.floor === b.floor ? 0 : 10000
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0)) + floorPenalty
}

function isCoreSwitch(dev: Device): boolean {
  return dev.dtype === 'switch' && (dev.name.toLowerCase().includes('core') || dev.id === '1')
}

/**
 * Client-side fallback topology inference matching backend/app/topology.py.
 */
export function inferTopologyLinks(devices: Device[]): TopologyLink[] {
  if (devices.length < 2) return []

  const links: TopologyLink[] = []
  const seen = new Set<string>()
  let seq = 1

  function addLink(
    srcId: string,
    dstId: string,
    linkType: TopologyLink['link_type'],
    bandwidthMbps: number,
    isRedundant = false,
  ) {
    if (srcId === dstId) return
    const key = srcId < dstId ? `${srcId}::${dstId}` : `${dstId}::${srcId}`
    if (seen.has(key)) return
    seen.add(key)
    links.push({
      id: `inferred-${seq++}`,
      source_device_id: srcId,
      target_device_id: dstId,
      link_type: linkType,
      bandwidth_mbps: bandwidthMbps,
      is_redundant: isRedundant,
      auto_inferred: true,
    })
  }

  const routers = devices.filter(d => d.dtype === 'router')
  const switches = devices.filter(d => d.dtype === 'switch')
  const aps = devices.filter(d => d.dtype === 'ap')
  const servers = devices.filter(d => d.dtype === 'server')

  let coreSwitches = switches.filter(isCoreSwitch)
  if (coreSwitches.length === 0 && switches.length > 0) {
    const f1 = switches.filter(s => s.floor === 1)
    const pool = f1.length > 0 ? f1 : switches
    coreSwitches = [pool[0]]
  }
  const primaryCore = coreSwitches[0] ?? null

  for (const rtr of routers) {
    const candidates = coreSwitches.length > 0 ? coreSwitches : switches
    if (candidates.length > 0) {
      const target = [...candidates].sort((a, b) => dist(rtr, a) - dist(rtr, b))[0]
      addLink(rtr.id, target.id, 'wan', 10000)
    }
  }

  if (primaryCore) {
    for (const sw of switches) {
      if (sw.id === primaryCore.id) continue
      const sameFloorCores = coreSwitches.filter(c => c.floor === sw.floor && c.id !== sw.id)
      const uplink =
        sameFloorCores.length > 0
          ? [...sameFloorCores].sort((a, b) => dist(sw, a) - dist(sw, b))[0]
          : primaryCore
      addLink(uplink.id, sw.id, 'trunk', uplink.id === primaryCore.id ? 10000 : 1000)
    }
  }

  for (const ap of aps) {
    const sameFloor = switches.filter(s => s.floor === ap.floor)
    const pool = sameFloor.length > 0 ? sameFloor : switches
    if (pool.length > 0) {
      const sw = [...pool].sort((a, b) => dist(ap, a) - dist(ap, b))[0]
      addLink(sw.id, ap.id, 'access', 1000)
    } else if (routers.length > 0) {
      const rtr = [...routers].sort((a, b) => dist(ap, a) - dist(ap, b))[0]
      addLink(rtr.id, ap.id, 'access', 1000)
    }
  }

  for (const srv of servers) {
    const sameFloor = switches.filter(s => s.floor === srv.floor)
    const pool = [...(sameFloor.length > 0 ? sameFloor : switches)].sort((a, b) => dist(srv, a) - dist(srv, b))
    if (pool.length > 0) {
      addLink(pool[0].id, srv.id, 'access', 10000)
      if (pool.length > 1) {
        addLink(pool[1].id, srv.id, 'redundancy', 10000, true)
      }
    } else if (routers.length > 0) {
      const rtr = [...routers].sort((a, b) => dist(srv, a) - dist(srv, b))[0]
      addLink(rtr.id, srv.id, 'access', 1000)
    }
  }

  return links
}

function findRootGateways(devices: Device[], links: TopologyLink[]): string[] {
  const onlineRouters = devices.filter(d => d.dtype === 'router' && d.status !== 'offline')
  if (onlineRouters.length > 0) return onlineRouters.map(r => r.id)
  const anyRouters = devices.filter(d => d.dtype === 'router')
  if (anyRouters.length > 0) return anyRouters.map(r => r.id)

  const degree = new Map<string, number>()
  for (const l of links) {
    degree.set(l.source_device_id, (degree.get(l.source_device_id) ?? 0) + 1)
    degree.set(l.target_device_id, (degree.get(l.target_device_id) ?? 0) + 1)
  }
  const switches = devices.filter(d => d.dtype === 'switch')
  if (switches.length > 0) {
    const best = [...switches].sort((a, b) => {
      const coreDiff = (isCoreSwitch(b) ? 1 : 0) - (isCoreSwitch(a) ? 1 : 0)
      if (coreDiff !== 0) return coreDiff
      return (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)
    })[0]
    return [best.id]
  }
  return devices.length > 0 ? [devices[0].id] : []
}

interface AdjacencyEdge {
  neighborId: string
  link: TopologyLink
}

interface ParentStep {
  parentId: string | null
  linkId: string | null
}

function bfsTree(
  rootIds: string[],
  adjacency: Map<string, AdjacencyEdge[]>,
  blockedDevices: Set<string>,
  blockedLinks: Set<string>,
  allowRedundant: boolean,
): { dist: Map<string, number>; parent: Map<string, ParentStep> } {
  const distMap = new Map<string, number>()
  const parentMap = new Map<string, ParentStep>()
  const queue: string[] = []
  for (const rid of rootIds) {
    if (!blockedDevices.has(rid) && !distMap.has(rid)) {
      distMap.set(rid, 0)
      parentMap.set(rid, { parentId: null, linkId: null })
      queue.push(rid)
    }
  }
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const curD = distMap.get(cur) ?? 0
    const edges = [...(adjacency.get(cur) ?? [])].sort(
      (a, b) => (a.link.is_redundant ? 1 : 0) - (b.link.is_redundant ? 1 : 0),
    )
    for (const { neighborId, link } of edges) {
      if (blockedLinks.has(link.id) || blockedDevices.has(neighborId) || distMap.has(neighborId)) {
        continue
      }
      if (!allowRedundant && link.is_redundant) continue
      distMap.set(neighborId, curD + 1)
      parentMap.set(neighborId, { parentId: cur, linkId: link.id })
      queue.push(neighborId)
    }
  }
  return { dist: distMap, parent: parentMap }
}

function traceDependencyChain(
  deviceId: string,
  parentMap: Map<string, ParentStep>,
  byId: Map<string, Device>,
  downDeviceIds: Set<string>,
  downLinkIds: Set<string>,
  lostUpstreams: string[],
): { causedById: string | null; causedByName: string | null; dependencyPath: string[] } {
  const chainIds: string[] = []
  let cur: string | null = deviceId
  const visited = new Set<string>()
  let causeId: string | null = null

  while (cur && !visited.has(cur)) {
    visited.add(cur)
    chainIds.push(cur)
    const step = parentMap.get(cur)
    if (!step) break
    if (downDeviceIds.has(cur)) {
      causeId = cur
    } else if (step.linkId && downLinkIds.has(step.linkId) && step.parentId) {
      causeId = step.parentId
    }
    cur = step.parentId
  }

  chainIds.reverse() // root -> ... -> deviceId

  if (!causeId) {
    const failedUp = lostUpstreams.find(uid => downDeviceIds.has(uid))
    if (failedUp) causeId = failedUp
    else if (downDeviceIds.size > 0) causeId = [...downDeviceIds].sort()[0]
    else if (lostUpstreams.length > 0) causeId = lostUpstreams[0]
  }

  let slicedIds: string[]
  if (causeId && chainIds.includes(causeId)) {
    slicedIds = chainIds.slice(chainIds.indexOf(causeId))
  } else if (causeId) {
    slicedIds = causeId !== deviceId ? [causeId, deviceId] : [deviceId]
  } else {
    slicedIds = chainIds
  }

  const dependencyPath = slicedIds.map(id => byId.get(id)?.name ?? id)
  const causedByName = causeId ? (byId.get(causeId)?.name ?? causeId) : null
  return { causedById: causeId, causedByName, dependencyPath }
}

export function computeBlastRadius(
  devices: Device[],
  links: TopologyLink[],
  downDeviceIds: Set<string>,
  downLinkIds: Set<string>,
  includeSpof = true,
): BlastRadiusReport {
  const byId = new Map(devices.map(d => [d.id, d]))
  const adjacency = new Map<string, AdjacencyEdge[]>()
  for (const l of links) {
    if (!byId.has(l.source_device_id) || !byId.has(l.target_device_id)) continue
    const srcList = adjacency.get(l.source_device_id) ?? []
    srcList.push({ neighborId: l.target_device_id, link: l })
    adjacency.set(l.source_device_id, srcList)

    const dstList = adjacency.get(l.target_device_id) ?? []
    dstList.push({ neighborId: l.source_device_id, link: l })
    adjacency.set(l.target_device_id, dstList)
  }

  const roots = findRootGateways(devices, links)
  const emptySet = new Set<string>()
  const { dist: baselineDist, parent: baselineParent } = bfsTree(roots, adjacency, emptySet, emptySet, true)
  const { dist: primaryBaselineDist, parent: primaryParent } = bfsTree(roots, adjacency, emptySet, emptySet, false)
  const { dist: primaryNowDist } = bfsTree(roots, adjacency, downDeviceIds, downLinkIds, false)
  const { dist: anyNowDist } = bfsTree(roots, adjacency, downDeviceIds, downLinkIds, true)

  const traceParent = new Map<string, ParentStep>(baselineParent)
  for (const [k, v] of primaryParent.entries()) {
    traceParent.set(k, v)
  }

  const deviceImpacts: DeviceImpactDetail[] = []
  const impactByDev = new Map<string, ImpactState>()
  const affectedFloorsSet = new Set<number>()

  for (const d of devices) {
    let activeIncidentLinks = 0
    const lostUpstreams = new Set<string>()
    let lostRedundancy = false
    const selfBaseD = baselineDist.get(d.id)
    const selfPrimaryD = primaryBaselineDist.get(d.id)

    for (const { neighborId, link } of adjacency.get(d.id) ?? []) {
      if (downLinkIds.has(link.id) || downDeviceIds.has(neighborId)) {
        const nbrD = baselineDist.get(neighborId)
        const nbrPrimaryD = primaryBaselineDist.get(neighborId)
        if (
          link.is_redundant ||
          (selfBaseD !== undefined && nbrD !== undefined && nbrD <= selfBaseD) ||
          (selfPrimaryD !== undefined && nbrPrimaryD !== undefined && nbrPrimaryD < selfPrimaryD)
        ) {
          lostUpstreams.add(neighborId)
          lostRedundancy = true
        }
      } else if (anyNowDist.has(neighborId)) {
        activeIncidentLinks += 1
      }
    }

    let state: ImpactState = 'healthy'
    let reason = 'All paths nominal'

    if (downDeviceIds.has(d.id)) {
      state = 'root_down'
      reason = 'Simulated direct outage'
    } else if (!anyNowDist.has(d.id) && baselineDist.has(d.id)) {
      state = 'unreachable'
      reason = 'All upstream paths to gateway severed'
    } else if (!anyNowDist.has(d.id) && !baselineDist.has(d.id) && roots.length === 0) {
      state = 'unreachable'
      reason = 'No gateway path available'
    } else if (
      anyNowDist.has(d.id) &&
      ((primaryBaselineDist.has(d.id) && !primaryNowDist.has(d.id)) || lostRedundancy)
    ) {
      state = 'degraded'
      reason = 'Operating on backup/redundant path or lost redundant uplink'
    }

    impactByDev.set(d.id, state)
    const sortedLostUpstreams = [...lostUpstreams].sort()
    let causedById: string | null = null
    let causedByName: string | null = null
    let dependencyPath: string[] = []

    if (state === 'root_down') {
      affectedFloorsSet.add(d.floor)
      causedById = d.id
      causedByName = d.name
      dependencyPath = [d.name]
    } else if (state === 'unreachable' || state === 'degraded') {
      affectedFloorsSet.add(d.floor)
      const traced = traceDependencyChain(d.id, traceParent, byId, downDeviceIds, downLinkIds, sortedLostUpstreams)
      causedById = traced.causedById
      causedByName = traced.causedByName
      dependencyPath = traced.dependencyPath
    }

    deviceImpacts.push({
      device_id: d.id,
      name: d.name,
      dtype: d.dtype,
      floor: d.floor,
      impact_state: state,
      reason,
      caused_by_device_id: causedById,
      caused_by_name: causedByName,
      dependency_path: dependencyPath,
      lost_upstream_ids: sortedLostUpstreams,
      remaining_path_count: activeIncidentLinks,
    })
  }

  const linkStates: Record<string, LinkImpactState> = {}
  for (const l of links) {
    const sidState = impactByDev.get(l.source_device_id)
    const tidState = impactByDev.get(l.target_device_id)
    if (downLinkIds.has(l.id) || downDeviceIds.has(l.source_device_id) || downDeviceIds.has(l.target_device_id)) {
      linkStates[l.id] = 'severed'
    } else if (sidState === 'unreachable' || tidState === 'unreachable') {
      linkStates[l.id] = 'isolated'
    } else if (l.is_redundant && (sidState === 'degraded' || tidState === 'degraded')) {
      linkStates[l.id] = 'failover_active'
    } else {
      linkStates[l.id] = 'active'
    }
  }

  const spofRanking: SpofCandidate[] = []
  if (includeSpof) {
    for (const d of devices) {
      if (d.dtype !== 'router' && d.dtype !== 'switch') continue
      const sim = computeBlastRadius(devices, links, new Set([d.id]), emptySet, false)
      const unreachItems = sim.device_impacts.filter(x => x.impact_state === 'unreachable')
      const degradItems = sim.device_impacts.filter(x => x.impact_state === 'degraded')
      const unreachableCount = unreachItems.length
      const degradedCount = degradItems.length
      const affectedDeviceNames = [...unreachItems, ...degradItems].map(x => x.name)
      spofRanking.push({
        device_id: d.id,
        name: d.name,
        dtype: d.dtype,
        floor: d.floor,
        unreachable_count: unreachableCount,
        degraded_count: degradedCount,
        affected_device_names: affectedDeviceNames,
        score: unreachableCount * 10 + degradedCount * 3,
      })
    }
    spofRanking.sort((a, b) => b.score - a.score || b.unreachable_count - a.unreachable_count || a.name.localeCompare(b.name))
  }

  const rootDownCount = deviceImpacts.filter(x => x.impact_state === 'root_down').length
  const unreachableCount = deviceImpacts.filter(x => x.impact_state === 'unreachable').length
  const degradedCount = deviceImpacts.filter(x => x.impact_state === 'degraded').length

  return {
    down_device_ids: [...downDeviceIds].sort(),
    down_link_ids: [...downLinkIds].sort(),
    summary: {
      total_devices: devices.length,
      root_down_count: rootDownCount,
      unreachable_count: unreachableCount,
      degraded_count: degradedCount,
      healthy_count: devices.length - rootDownCount - unreachableCount - degradedCount,
    },
    device_impacts: deviceImpacts,
    link_states: linkStates,
    affected_floors: [...affectedFloorsSet].sort((a, b) => a - b),
    spof_ranking: spofRanking.slice(0, 10),
  }
}
