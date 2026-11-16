"""
Network Topology Inference, Device-to-Device Blast-Radius Propagation, and SPOF Analysis Engine.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict, deque
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


def _dist(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    ax = float(a.get("x") or 0.0)
    ay = float(a.get("y") or 0.0)
    bx = float(b.get("x") or 0.0)
    by = float(b.get("y") or 0.0)
    floor_penalty = 0.0 if a.get("floor") == b.get("floor") else 10000.0
    return math.hypot(ax - bx, ay - by) + floor_penalty


def _is_core_switch(dev: Dict[str, Any]) -> bool:
    name = (dev.get("name") or "").lower()
    return dev.get("dtype") == "switch" and ("core" in name or str(dev.get("id")) == "1")


def infer_topology_links(
    devices: List[Dict[str, Any]],
    interfaces: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Infers campus network topology links from:
    1. Explicit interface descriptions (e.g. "Uplink to RTR-01", "Trunk to SW-DIST-01").
    2. Hierarchical network role rules (Router -> Core Switch -> Dist/Floor Switch -> AP/Server),
       preserving cross-floor uplinks when switches exist on multiple floors.
    """
    if len(devices) < 2:
        return []

    by_id: Dict[str, Dict[str, Any]] = {str(d["id"]): d for d in devices}
    by_name_lower: Dict[str, Dict[str, Any]] = {
        (d.get("name") or "").strip().lower(): d for d in devices if d.get("name")
    }

    links: List[Dict[str, Any]] = []
    seen_pairs: Set[Tuple[str, str]] = set()

    def add_link(
        src_id: str,
        dst_id: str,
        link_type: str = "uplink",
        bw: int = 1000,
        src_port: Optional[str] = None,
        dst_port: Optional[str] = None,
        is_redundant: bool = False,
    ) -> None:
        if src_id == dst_id:
            return
        pair = (min(src_id, dst_id), max(src_id, dst_id))
        if pair in seen_pairs:
            return
        seen_pairs.add(pair)
        links.append(
            {
                "source_device_id": src_id,
                "target_device_id": dst_id,
                "source_port": src_port,
                "target_port": dst_port,
                "link_type": link_type,
                "bandwidth_mbps": bw,
                "is_redundant": is_redundant,
                "auto_inferred": True,
            }
        )

    # 1. Parse interface descriptions if available
    if interfaces:
        for iface in interfaces:
            desc = (iface.get("description") or "").strip()
            src_id = str(iface.get("device_id"))
            if not desc or src_id not in by_id:
                continue
            desc_low = desc.lower()
            for name_low, peer in by_name_lower.items():
                peer_id = str(peer["id"])
                if peer_id == src_id or not name_low:
                    continue
                if re.search(rf"\b{re.escape(name_low)}\b", desc_low):
                    src_dev = by_id[src_id]
                    ltype = (
                        "wan"
                        if "router" in (src_dev.get("dtype"), peer.get("dtype"))
                        else "redundancy"
                        if "backup" in desc_low or "redund" in desc_low
                        else "trunk"
                        if "trunk" in desc_low or (src_dev.get("dtype") == "switch" and peer.get("dtype") == "switch")
                        else "access"
                    )
                    speed_bps = iface.get("speed_bps") or 1_000_000_000
                    bw = max(100, int(speed_bps // 1_000_000))
                    add_link(
                        src_id,
                        peer_id,
                        link_type=ltype,
                        bw=bw,
                        src_port=iface.get("name"),
                        is_redundant=(ltype == "redundancy"),
                    )

    routers = [d for d in devices if d.get("dtype") == "router"]
    switches = [d for d in devices if d.get("dtype") == "switch"]
    aps = [d for d in devices if d.get("dtype") == "ap"]
    servers = [d for d in devices if d.get("dtype") == "server"]

    core_switches = [s for s in switches if _is_core_switch(s)]
    if not core_switches and switches:
        floor1_sw = [s for s in switches if s.get("floor") == 1] or switches
        core_switches = [min(floor1_sw, key=lambda s: int(s["id"]) if str(s["id"]).isdigit() else 0)]

    primary_core = core_switches[0] if core_switches else None

    # 2. Connect each Router -> nearest Core Switch (or nearest Switch)
    for rtr in routers:
        candidates = core_switches or switches
        if candidates:
            target = min(candidates, key=lambda s: _dist(rtr, s))
            add_link(str(rtr["id"]), str(target["id"]), link_type="wan", bw=10000)

    # 3. Connect Distribution/Access Switches -> Core Switch (cross-floor allowed)
    if primary_core:
        core_id = str(primary_core["id"])
        for sw in switches:
            sw_id = str(sw["id"])
            if sw_id == core_id:
                continue
            same_floor_cores = [c for c in core_switches if c.get("floor") == sw.get("floor") and str(c["id"]) != sw_id]
            uplink = min(same_floor_cores, key=lambda c: _dist(sw, c)) if same_floor_cores else primary_core
            add_link(str(uplink["id"]), sw_id, link_type="trunk", bw=10000 if uplink == primary_core else 1000)

    # 4. Connect APs -> nearest Switch (prefer same floor)
    for ap in aps:
        same_floor = [s for s in switches if s.get("floor") == ap.get("floor")]
        pool_sw = same_floor or switches
        if pool_sw:
            sw = min(pool_sw, key=lambda s: _dist(ap, s))
            add_link(str(sw["id"]), str(ap["id"]), link_type="access", bw=1000)
        elif routers:
            rtr = min(routers, key=lambda r: _dist(ap, r))
            add_link(str(rtr["id"]), str(ap["id"]), link_type="access", bw=1000)

    # 5. Connect Servers -> nearest Switch (and secondary redundant switch if available on same floor)
    for srv in servers:
        same_floor = [s for s in switches if s.get("floor") == srv.get("floor")]
        pool_sw = sorted(same_floor or switches, key=lambda s: _dist(srv, s))
        if pool_sw:
            add_link(str(pool_sw[0]["id"]), str(srv["id"]), link_type="access", bw=10000)
            if len(pool_sw) > 1:
                add_link(
                    str(pool_sw[1]["id"]),
                    str(srv["id"]),
                    link_type="redundancy",
                    bw=10000,
                    is_redundant=True,
                )
        elif routers:
            rtr = min(routers, key=lambda r: _dist(srv, r))
            add_link(str(rtr["id"]), str(srv["id"]), link_type="access", bw=1000)

    return links


def _find_root_gateways(devices: List[Dict[str, Any]], links: List[Dict[str, Any]]) -> List[str]:
    routers = [str(d["id"]) for d in devices if d.get("dtype") == "router"]
    if routers:
        return routers
    degree: Dict[str, int] = defaultdict(int)
    for l in links:
        degree[str(l["source_device_id"])] += 1
        degree[str(l["target_device_id"])] += 1
    switches = [d for d in devices if d.get("dtype") == "switch"]
    if switches:
        best = max(switches, key=lambda s: (1 if _is_core_switch(s) else 0, degree[str(s["id"])]))
        return [str(best["id"])]
    return [str(devices[0]["id"])] if devices else []


def _bfs_tree(
    root_ids: Iterable[str],
    adjacency: Dict[str, List[Tuple[str, Dict[str, Any]]]],
    blocked_devices: Set[str],
    blocked_links: Set[str],
    allow_redundant: bool = True,
) -> Tuple[Dict[str, int], Dict[str, Tuple[Optional[str], Optional[str]]]]:
    """
    Returns (dist_map, parent_map) where parent_map[node] = (parent_device_id, link_id).
    Prefers non-redundant links first when expanding neighbors.
    """
    dist: Dict[str, int] = {}
    parent: Dict[str, Tuple[Optional[str], Optional[str]]] = {}
    q: deque[str] = deque()
    for rid in root_ids:
        if rid not in blocked_devices and rid not in dist:
            dist[rid] = 0
            parent[rid] = (None, None)
            q.append(rid)
    while q:
        cur = q.popleft()
        cur_d = dist[cur]
        edges = sorted(adjacency.get(cur, []), key=lambda x: 1 if x[1].get("is_redundant") else 0)
        for nbr, link in edges:
            lid = str(link["id"])
            if lid in blocked_links or nbr in blocked_devices or nbr in dist:
                continue
            if not allow_redundant and link.get("is_redundant"):
                continue
            dist[nbr] = cur_d + 1
            parent[nbr] = (cur, lid)
            q.append(nbr)
    return dist, parent


def _trace_dependency_chain(
    did: str,
    parent_map: Dict[str, Tuple[Optional[str], Optional[str]]],
    by_id: Dict[str, Dict[str, Any]],
    down_devs: Set[str],
    down_links: Set[str],
    lost_upstreams: List[str],
) -> Tuple[Optional[str], Optional[str], List[str]]:
    """
    Reconstructs the upstream chain for an impacted device and identifies the root cause device.
    """
    chain_ids: List[str] = []
    cur: Optional[str] = did
    visited: Set[str] = set()
    cause_id: Optional[str] = None

    while cur is not None and cur not in visited:
        visited.add(cur)
        chain_ids.append(cur)
        par_info = parent_map.get(cur)
        if not par_info:
            break
        par_dev, par_link = par_info
        if cur in down_devs:
            cause_id = cur
        elif par_link and par_link in down_links and par_dev:
            cause_id = par_dev
        cur = par_dev

    chain_ids.reverse()  # root -> ... -> did

    if cause_id is None:
        for uid in lost_upstreams:
            if uid in down_devs:
                cause_id = uid
                break
        if cause_id is None and down_devs:
            cause_id = sorted(down_devs)[0]
        elif cause_id is None and lost_upstreams:
            cause_id = lost_upstreams[0]

    if cause_id and cause_id in chain_ids:
        idx = chain_ids.index(cause_id)
        sliced = chain_ids[idx:]
    elif cause_id:
        sliced = [cause_id, did] if cause_id != did else [did]
    else:
        sliced = chain_ids

    path_names = [by_id[x].get("name") or x for x in sliced if x in by_id]
    cause_name = (by_id[cause_id].get("name") if cause_id in by_id else cause_id) if cause_id else None
    return cause_id, cause_name, path_names


def compute_blast_radius(
    devices: List[Dict[str, Any]],
    links: List[Dict[str, Any]],
    down_device_ids: Iterable[str],
    down_link_ids: Iterable[str],
    include_spof: bool = True,
) -> Dict[str, Any]:
    """
    Computes device-to-device cascading impact when specified devices or links go down.
    """
    down_devs = {str(x) for x in down_device_ids}
    down_links = {str(x) for x in down_link_ids}
    by_id: Dict[str, Dict[str, Any]] = {str(d["id"]): d for d in devices}

    adjacency: Dict[str, List[Tuple[str, Dict[str, Any]]]] = defaultdict(list)
    for l in links:
        sid = str(l["source_device_id"])
        tid = str(l["target_device_id"])
        if sid in by_id and tid in by_id:
            adjacency[sid].append((tid, l))
            adjacency[tid].append((sid, l))

    roots = _find_root_gateways(devices, links)
    baseline_dist, baseline_parent = _bfs_tree(roots, adjacency, set(), set(), allow_redundant=True)
    primary_baseline_dist, primary_parent = _bfs_tree(roots, adjacency, set(), set(), allow_redundant=False)
    primary_now_dist, _ = _bfs_tree(roots, adjacency, down_devs, down_links, allow_redundant=False)
    any_now_dist, _ = _bfs_tree(roots, adjacency, down_devs, down_links, allow_redundant=True)

    # Merge primary_parent into baseline_parent so primary tree paths are preferred for tracing
    trace_parent = dict(baseline_parent)
    trace_parent.update(primary_parent)

    baseline_reachable = set(baseline_dist.keys())
    any_reachable_now = set(any_now_dist.keys())

    device_impacts: List[Dict[str, Any]] = []
    impact_by_dev: Dict[str, str] = {}
    affected_floors: Set[int] = set()

    for d in devices:
        did = str(d["id"])
        active_incident_links = 0
        lost_upstreams: List[str] = []
        lost_redundancy = False
        self_base_d = baseline_dist.get(did)
        self_primary_d = primary_baseline_dist.get(did)

        for nbr, link in adjacency.get(did, []):
            lid = str(link["id"])
            if lid in down_links or nbr in down_devs:
                nbr_d = baseline_dist.get(nbr)
                if link.get("is_redundant") or (
                    self_base_d is not None and nbr_d is not None and nbr_d <= self_base_d
                ):
                    lost_upstreams.append(nbr)
                    lost_redundancy = True
                elif (
                    self_primary_d is not None
                    and primary_baseline_dist.get(nbr) is not None
                    and primary_baseline_dist[nbr] < self_primary_d
                ):
                    lost_upstreams.append(nbr)
                    lost_redundancy = True
            elif nbr in any_reachable_now:
                active_incident_links += 1

        if did in down_devs:
            state = "root_down"
            reason = "Simulated direct outage"
        elif did not in any_reachable_now and did in baseline_reachable:
            state = "unreachable"
            reason = "All upstream paths to gateway severed"
        elif did not in any_reachable_now and did not in baseline_reachable and not roots:
            state = "unreachable"
            reason = "No gateway path available"
        elif did in any_reachable_now and (
            (did in primary_baseline_dist and did not in primary_now_dist)
            or lost_redundancy
        ):
            state = "degraded"
            reason = "Operating on backup/redundant path or lost redundant uplink"
        else:
            state = "healthy"
            reason = "All paths nominal"

        impact_by_dev[did] = state
        caused_by_id: Optional[str] = None
        caused_by_name: Optional[str] = None
        dep_path: List[str] = []

        if state == "root_down":
            affected_floors.add(int(d.get("floor") or 1))
            caused_by_id = did
            caused_by_name = d.get("name") or did
            dep_path = [caused_by_name]
        elif state in ("unreachable", "degraded"):
            affected_floors.add(int(d.get("floor") or 1))
            caused_by_id, caused_by_name, dep_path = _trace_dependency_chain(
                did, trace_parent, by_id, down_devs, down_links, lost_upstreams
            )

        device_impacts.append(
            {
                "device_id": did,
                "name": d.get("name") or did,
                "dtype": d.get("dtype") or "switch",
                "floor": int(d.get("floor") or 1),
                "impact_state": state,
                "reason": reason,
                "caused_by_device_id": caused_by_id,
                "caused_by_name": caused_by_name,
                "dependency_path": dep_path,
                "lost_upstream_ids": sorted(set(lost_upstreams)),
                "remaining_path_count": active_incident_links,
            }
        )

    link_states: Dict[str, str] = {}
    for l in links:
        lid = str(l["id"])
        sid = str(l["source_device_id"])
        tid = str(l["target_device_id"])
        if lid in down_links:
            link_states[lid] = "severed"
        elif sid in down_devs or tid in down_devs:
            link_states[lid] = "severed"
        elif impact_by_dev.get(sid) == "unreachable" or impact_by_dev.get(tid) == "unreachable":
            link_states[lid] = "isolated"
        elif l.get("is_redundant") and (
            impact_by_dev.get(sid) == "degraded" or impact_by_dev.get(tid) == "degraded"
        ):
            link_states[lid] = "failover_active"
        else:
            link_states[lid] = "active"

    spof_ranking: List[Dict[str, Any]] = []
    if include_spof:
        for d in devices:
            if d.get("dtype") not in ("router", "switch"):
                continue
            did = str(d["id"])
            sim = compute_blast_radius(devices, links, [did], [], include_spof=False)
            unreach_items = [item for item in sim["device_impacts"] if item["impact_state"] == "unreachable"]
            degrad_items = [item for item in sim["device_impacts"] if item["impact_state"] == "degraded"]
            unreach = len(unreach_items)
            degrad = len(degrad_items)
            affected_names = [item["name"] for item in unreach_items + degrad_items]
            score = unreach * 10 + degrad * 3
            spof_ranking.append(
                {
                    "device_id": did,
                    "name": d.get("name") or did,
                    "dtype": d.get("dtype") or "switch",
                    "floor": int(d.get("floor") or 1),
                    "unreachable_count": unreach,
                    "degraded_count": degrad,
                    "affected_device_names": affected_names,
                    "score": score,
                }
            )
        spof_ranking.sort(key=lambda x: (-x["score"], -x["unreachable_count"], x["name"]))

    root_down_cnt = sum(1 for x in device_impacts if x["impact_state"] == "root_down")
    unreachable_cnt = sum(1 for x in device_impacts if x["impact_state"] == "unreachable")
    degraded_cnt = sum(1 for x in device_impacts if x["impact_state"] == "degraded")

    return {
        "down_device_ids": sorted(down_devs),
        "down_link_ids": sorted(down_links),
        "summary": {
            "total_devices": len(devices),
            "root_down_count": root_down_cnt,
            "unreachable_count": unreachable_cnt,
            "degraded_count": degraded_cnt,
            "healthy_count": len(devices) - root_down_cnt - unreachable_cnt - degraded_cnt,
        },
        "device_impacts": device_impacts,
        "link_states": link_states,
        "affected_floors": sorted(affected_floors),
        "spof_ranking": spof_ranking[:10],
    }
