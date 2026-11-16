from typing import Literal, Optional
from pydantic import BaseModel, Field

DeviceStatus = Literal['online', 'warning', 'offline']
DeviceType = Literal['switch', 'ap', 'router', 'server']

class DeviceBase(BaseModel):
    name: str
    dtype: DeviceType = 'switch'
    floor: Literal[1, 2] = 1
    x: Optional[float] = None
    y: Optional[float] = None
    locked: Optional[bool] = True
    ip: Optional[str] = None
    model: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    target_room: Optional[str] = None

class DeviceCreate(DeviceBase):
    snmp_port: int = 161
    snmp_version: Literal['v1', 'v2c', 'v3'] = 'v2c'
    credential_ref: Optional[str] = 'public'
    poll_interval_s: int = 60
    location: Optional[str] = None
    enabled: bool = True

class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    dtype: Optional[DeviceType] = None
    floor: Optional[Literal[1, 2]] = None
    x: Optional[float] = None
    y: Optional[float] = None
    locked: Optional[bool] = None
    ip: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    enabled: Optional[bool] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    target_room: Optional[str] = None

class DeviceOut(BaseModel):
    id: str
    name: str
    dtype: DeviceType
    status: DeviceStatus
    floor: Literal[1, 2]
    x: float
    y: float
    locked: bool = True
    ip: Optional[str] = None
    model: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    target_room: Optional[str] = None

class InterfaceOut(BaseModel):
    id: str
    device_id: str
    if_index: int
    name: str
    description: Optional[str] = None
    mac_address: Optional[str] = None
    speed_bps: Optional[int] = None
    admin_status: Optional[str] = None
    oper_status: Optional[str] = None

class InterfaceTrafficOut(BaseModel):
    id: int
    if_index: int
    name: str
    description: Optional[str] = None
    mac_address: Optional[str] = None
    speed_bps: Optional[int] = None
    oper_status: Optional[str] = None
    in_mbps: float = 0.0
    out_mbps: float = 0.0

class TrafficSeriesOut(BaseModel):
    has_snmp: bool
    interface_id: str
    inbound: list[float]
    outbound: list[float]
    labels: list[str]
    peak: float
    avg: float
    timestamp: str

class PollTrafficResult(BaseModel):
    success: bool
    has_snmp: bool
    interfaces_polled: int
    total_in_mbps: float
    total_out_mbps: float
    timestamp: str
    interfaces: list[InterfaceTrafficOut] = []
    uptime: Optional[str] = None
    mac_address: Optional[str] = None
    ping_ms: Optional[float] = None
    cpu_percent: Optional[float] = None
    memory_percent: Optional[float] = None
    temperature_c: Optional[float] = None

class DeviceDetailOut(BaseModel):
    device: DeviceOut
    interfaces: list[InterfaceOut] = []
    latest_metrics: dict = {}
    uptime: Optional[str] = None
    mac_address: Optional[str] = None
    ping_ms: Optional[float] = None
    cpu_percent: Optional[float] = None
    memory_percent: Optional[float] = None
    temperature_c: Optional[float] = None

class BuildingCornersModel(BaseModel):
    nw: list[float]  # [lat, lon]
    ne: list[float]
    se: list[float]
    sw: list[float]

class BuildingBoundsModel(BaseModel):
    north: float
    south: float
    east: float
    west: float
    ground_altitude: Optional[float] = None
    floor_height_m: Optional[float] = 3.5
    corners: Optional[BuildingCornersModel] = None

class RoomModel(BaseModel):
    label: str
    left: float
    top: float
    width: float
    height: float
    type: Optional[str] = "room"
    connectsToFloor: Optional[int] = None

class ScanRequest(BaseModel):
    cidr: Optional[str] = "auto"
    community: Optional[str] = None
    snmp_port: int = 161
    scan_mode: Optional[str] = "quick" # "quick" (ARP + core IPs < 2s) or "full" (all 254 IPs)
    floor_split_ip: Optional[int] = 120 # IPs > floor_split_ip assigned to Floor 2
    building_bounds: Optional[BuildingBoundsModel] = None
    auto_assign_gps: Optional[bool] = True
    floor_rooms: Optional[dict[int, list[RoomModel]]] = None

class LocalNetworkInfo(BaseModel):
    local_ip: str
    detected_subnet: str
    gateway: Optional[str] = None
    wifi_ssid: Optional[str] = None
    wifi_bssid: Optional[str] = None
    wifi_signal: Optional[str] = None

class DiscoveredDevice(BaseModel):
    ip: str
    hostname: Optional[str] = None
    sys_descr: Optional[str] = None
    dtype: DeviceType = "switch"
    snmp_ok: bool = False
    community: Optional[str] = None
    response_time_ms: float = 0.0
    already_exists: bool = False
    target_room: Optional[str] = None
    preview_x: Optional[float] = None
    preview_y: Optional[float] = None
    confidence: int = 85
    reason: Optional[str] = None
    detected_floor: int = 1
    floor_reason: Optional[str] = None
    mac: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    gps_source: Optional[str] = None

class ImportItem(BaseModel):
    name: str
    ip: str
    dtype: DeviceType = "switch"
    floor: Literal[1, 2] = 1
    x: Optional[float] = None
    y: Optional[float] = None
    model: Optional[str] = None
    community: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    target_room: Optional[str] = None

class ImportRequest(BaseModel):
    devices: list[ImportItem]

class ConnectResult(BaseModel):
    device_id: str
    success: bool
    status: DeviceStatus
    message: str
    sys_uptime: Optional[str] = None

class AlertOut(BaseModel):
    id: int
    device_id: str
    severity: Literal['info', 'warn', 'crit']
    icon: str
    title: str
    description: Optional[str] = None
    created_at: str
    acknowledged: bool
    acknowledged_by: Optional[str] = None

class AlertCreate(BaseModel):
    severity: Literal['info', 'warn', 'crit'] = 'info'
    icon: Optional[str] = ''
    title: str
    description: Optional[str] = None


LinkType = Literal['wan', 'uplink', 'trunk', 'access', 'redundancy']
ImpactState = Literal['healthy', 'root_down', 'unreachable', 'degraded']


class TopologyLinkCreate(BaseModel):
    source_device_id: str
    target_device_id: str
    source_port: Optional[str] = None
    target_port: Optional[str] = None
    link_type: LinkType = 'uplink'
    bandwidth_mbps: int = Field(default=1000, gt=0)
    is_redundant: bool = False


class TopologyLinkOut(BaseModel):
    id: str
    source_device_id: str
    target_device_id: str
    source_port: Optional[str] = None
    target_port: Optional[str] = None
    link_type: LinkType = 'uplink'
    bandwidth_mbps: int = 1000
    is_redundant: bool = False
    auto_inferred: bool = False


class SimulationImpactRequest(BaseModel):
    down_device_ids: list[str] = Field(default_factory=list)
    down_link_ids: list[str] = Field(default_factory=list)
    include_spof: bool = True


class AffectedDeviceOut(BaseModel):
    device_id: str
    name: str
    dtype: DeviceType
    floor: int
    impact_state: ImpactState
    reason: str
    caused_by_device_id: Optional[str] = None
    caused_by_name: Optional[str] = None
    dependency_path: list[str] = Field(default_factory=list)
    lost_upstream_ids: list[str] = Field(default_factory=list)
    remaining_path_count: int = 0


class SpofCandidateOut(BaseModel):
    device_id: str
    name: str
    dtype: DeviceType
    floor: int
    unreachable_count: int
    degraded_count: int
    affected_device_names: list[str] = Field(default_factory=list)
    score: int


class SimulationImpactResponse(BaseModel):
    down_device_ids: list[str]
    down_link_ids: list[str]
    summary: dict
    device_impacts: list[AffectedDeviceOut]
    link_states: dict[str, str]
    affected_floors: list[int]
    spof_ranking: list[SpofCandidateOut] = Field(default_factory=list)


class ApplyFaultsRequest(BaseModel):
    down_device_ids: list[str] = Field(default_factory=list)
    down_link_ids: list[str] = Field(default_factory=list)
    clear_existing_simulated: bool = True



