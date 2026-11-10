import math
import re
from typing import List, Tuple, Dict, Any, Optional

# Room layout definitions aligned with FloorCanvas UI
ROOMS: Dict[int, List[Dict[str, Any]]] = {
    1: [
        {"label": "Server Room",      "left": 20,  "top": 20,  "width": 200, "height": 160, "allowed": ["server", "switch"]},
        {"label": "Network Core",     "left": 240, "top": 20,  "width": 200, "height": 160, "allowed": ["switch", "router"]},
        {"label": "Zone A – Office",  "left": 460, "top": 20,  "width": 340, "height": 160, "allowed": ["ap", "switch"]},
        {"label": "Zone B – Meeting", "left": 20,  "top": 200, "width": 360, "height": 170, "allowed": ["ap"]},
        {"label": "Zone C – Lab",     "left": 400, "top": 200, "width": 400, "height": 170, "allowed": ["ap", "switch"]},
        {"label": "IT Office",        "left": 20,  "top": 390, "width": 250, "height": 130, "allowed": ["switch", "server"]},
        {"label": "Zone D – Lounge",  "left": 290, "top": 390, "width": 510, "height": 130, "allowed": ["ap"]},
    ],
    2: [
        {"label": "Zone E – Office",  "left": 20,  "top": 20,  "width": 380, "height": 160, "allowed": ["switch", "ap"]},
        {"label": "Zone F – Lab",     "left": 420, "top": 20,  "width": 380, "height": 160, "allowed": ["server", "switch", "ap"]},
        {"label": "Zone G – Meeting", "left": 20,  "top": 200, "width": 780, "height": 160, "allowed": ["ap"]},
        {"label": "Zone H – Lounge",  "left": 20,  "top": 380, "width": 780, "height": 140, "allowed": ["ap"]},
    ],
}

# Building Geofence Anchors (North-West and South-East corners of facility, ~37m x ~22m)
BUILDING_GEO_ANCHORS = {
    "lat_top": 18.703300,     # North edge -> maps to canvas y = 40
    "lat_bottom": 18.703100,  # South edge -> maps to canvas y = 560
    "lon_left": 98.909100,    # West edge  -> maps to canvas x = 40
    "lon_right": 98.909450,   # East edge  -> maps to canvas x = 860
    "ground_altitude": 310.0, # Ground elevation in meters
    "floor_height_m": 3.5,    # Height per floor in meters
}

MIN_DEVICE_DIST = 52.0

def extract_device_geodata(text: Optional[str]) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[int]]:
    """
    Extracts latitude, longitude, altitude, and explicit floor from SNMP or telemetry strings.
    Supports:
      - RFC 5870: geo:18.7032,98.9094 or geo:18.7032,98.9094,314.5;floor=2;u=10
      - Bracketed: [18.7032, 98.9094], [18.7032, 98.9094, 314.5], [18.7032, 98.9094, fl:2]
      - Key-value: lat=18.7032 lon=98.9094 alt=314.5 fl=2
      - Hemisphere: 18.7032 N, 98.9094 E
      - Plain: 18.7032, 98.9094
      - Floor tags: floor=2, fl:2, level=2, ชั้น 2, Floor 2, 2F
    Returns: (latitude, longitude, altitude, explicit_floor)
    """
    if not text or not text.strip():
        return None, None, None, None

    cleaned = text.strip()
    lat: Optional[float] = None
    lon: Optional[float] = None
    alt: Optional[float] = None
    explicit_floor: Optional[int] = None

    # Check for explicit floor keywords in string
    m_floor = re.search(r'(?:(?:^|[\s,;\[\(])(?:floor|fl|level|ชั้น)\s*[:=]?\s*([12]))|(?:(?:^|[\s,;\[\(])([12])\s*[fF](?:[\s,;\]\)]|$))', cleaned, re.IGNORECASE)
    if m_floor:
        fl_val = m_floor.group(1) or m_floor.group(2)
        if fl_val:
            try:
                explicit_floor = int(fl_val)
            except ValueError:
                pass

    # 1. RFC 5870 (geo:lat,lon[,alt][;params])
    m_geo = re.search(r'geo:\s*([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)(?:\s*,\s*([+-]?\d+\.?\d*))?', cleaned, re.IGNORECASE)
    if m_geo:
        lat = float(m_geo.group(1))
        lon = float(m_geo.group(2))
        alt = float(m_geo.group(3)) if m_geo.group(3) else None
        return lat, lon, alt, explicit_floor

    # 2. Bracketed: [lat, lon, alt?] or (lat, lon, alt?)
    m_bracket = re.search(r'[\[\(]\s*([+-]?\d{1,2}\.?\d+)\s*,\s*([+-]?\d{1,3}\.?\d+)(?:\s*,\s*([+-]?\d+\.?\d*))?', cleaned)
    if m_bracket:
        lat = float(m_bracket.group(1))
        lon = float(m_bracket.group(2))
        alt = float(m_bracket.group(3)) if m_bracket.group(3) else None
        return lat, lon, alt, explicit_floor

    # 3. Key-Value style: lat=... lon=... [alt=...]
    m_kv_lat = re.search(r'(?:lat|latitude)[\s:=]+([+-]?\d{1,2}\.?\d+)', cleaned, re.IGNORECASE)
    m_kv_lon = re.search(r'(?:lon|lng|longitude)[\s:=]+([+-]?\d{1,3}\.?\d+)', cleaned, re.IGNORECASE)
    if m_kv_lat and m_kv_lon:
        lat = float(m_kv_lat.group(1))
        lon = float(m_kv_lon.group(1))
        m_kv_alt = re.search(r'(?:alt|altitude|elev)[\s:=]+([+-]?\d+\.?\d*)', cleaned, re.IGNORECASE)
        alt = float(m_kv_alt.group(1)) if m_kv_alt else None
        return lat, lon, alt, explicit_floor

    # 4. Hemisphere notation (e.g., 18.7032 N, 98.9094 E)
    m_hemi = re.search(r'(\d+\.?\d*)\s*°?\s*([NSns])[\s,]+(\d+\.?\d*)\s*°?\s*([EWew])', cleaned)
    if m_hemi:
        lat = float(m_hemi.group(1)) * (-1 if m_hemi.group(2).upper() == 'S' else 1)
        lon = float(m_hemi.group(3)) * (-1 if m_hemi.group(4).upper() == 'W' else 1)
        return lat, lon, alt, explicit_floor

    # 5. Keyword GPS: lat, lon
    m_kw = re.search(r'(?:gps|coord|lat\/lon|loc)[\s:=]+([+-]?\d{1,2}\.?\d+)[\s,]+([+-]?\d{1,3}\.?\d+)', cleaned, re.IGNORECASE)
    if m_kw:
        lat = float(m_kw.group(1))
        lon = float(m_kw.group(2))
        return lat, lon, alt, explicit_floor

    # 6. Plain comma-separated floats
    m_plain = re.search(r'([+-]?\d{1,2}\.\d{3,})\s*,\s*([+-]?\d{1,3}\.\d{3,})', cleaned)
    if m_plain:
        lat = float(m_plain.group(1))
        lon = float(m_plain.group(2))
        return lat, lon, alt, explicit_floor

    return None, None, None, explicit_floor

def parse_gps_from_location(sys_location: Optional[str]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Backward-compatible helper parsing (latitude, longitude, altitude).
    """
    lat, lon, alt, _ = extract_device_geodata(sys_location)
    return lat, lon, alt

def _get_bounds_corners(bounds: Any) -> Optional[Dict[str, List[float]]]:
    if not bounds:
        return None
    corners_obj = getattr(bounds, "corners", None) if not isinstance(bounds, dict) else bounds.get("corners")
    if not corners_obj:
        return None
    if isinstance(corners_obj, dict):
        return corners_obj
    # Pydantic model
    return {
        "nw": getattr(corners_obj, "nw", None),
        "ne": getattr(corners_obj, "ne", None),
        "se": getattr(corners_obj, "se", None),
        "sw": getattr(corners_obj, "sw", None),
    }

def project_gps_to_canvas(
    lat: float,
    lon: float,
    floor: int = 1,
    bounds: Optional[Any] = None,
    canvas_w: float = 860.0,
    canvas_h: float = 560.0,
    custom_rooms: Optional[Dict[int, List[Any]]] = None,
) -> Tuple[float, float, Optional[str]]:
    """
    Maps GPS latitude & longitude coordinates to (x, y) canvas coordinates and resolves room.
    Supports dynamic 4-corner bilinear interpolation matching the frontend mapGeo.ts.
    """
    corners = _get_bounds_corners(bounds)
    if (
        corners and 
        corners.get("nw") and corners.get("ne") and 
        corners.get("se") and corners.get("sw")
    ):
        nw = corners["nw"]
        ne = corners["ne"]
        se = corners["se"]
        sw = corners["sw"]

        vx_lat = ne[0] - nw[0]
        vx_lon = ne[1] - nw[1]
        vy_lat = sw[0] - nw[0]
        vy_lon = sw[1] - nw[1]
        det = vx_lat * vy_lon - vx_lon * vy_lat

        if abs(det) > 1e-13:
            d_lat = lat - nw[0]
            d_lon = lon - nw[1]
            u = (d_lat * vy_lon - d_lon * vy_lat) / det
            v = (vx_lat * d_lon - vx_lon * d_lat) / det
        else:
            u, v = 0.5, 0.5

        u = max(0.0, min(1.0, u))
        v = max(0.0, min(1.0, v))

        canvas_x = 40.0 + u * (canvas_w - 80.0)
        canvas_y = 40.0 + v * (canvas_h - 80.0)
    else:
        # Fallback to bounding box (either from bounds model or BUILDING_GEO_ANCHORS)
        b_north = getattr(bounds, "north", None) if not isinstance(bounds, dict) else bounds.get("north")
        b_south = getattr(bounds, "south", None) if not isinstance(bounds, dict) else bounds.get("south")
        b_west = getattr(bounds, "west", None) if not isinstance(bounds, dict) else bounds.get("west")
        b_east = getattr(bounds, "east", None) if not isinstance(bounds, dict) else bounds.get("east")

        if b_north is not None and b_south is not None and b_west is not None and b_east is not None:
            lat_top = float(b_north)
            lat_bottom = float(b_south)
            lon_left = float(b_west)
            lon_right = float(b_east)
        else:
            lat_top = BUILDING_GEO_ANCHORS["lat_top"]
            lat_bottom = BUILDING_GEO_ANCHORS["lat_bottom"]
            lon_left = BUILDING_GEO_ANCHORS["lon_left"]
            lon_right = BUILDING_GEO_ANCHORS["lon_right"]

        lat_span = lat_top - lat_bottom
        lon_span = lon_right - lon_left

        if lat_span == 0 or lon_span == 0:
            return 450.0, 300.0, resolve_room_from_coords(floor, 450.0, 300.0, custom_rooms)

        norm_x = (lon - lon_left) / lon_span
        norm_y = (lat_top - lat) / lat_span

        norm_x = max(0.0, min(1.0, norm_x))
        norm_y = max(0.0, min(1.0, norm_y))

        canvas_x = 40.0 + norm_x * (canvas_w - 80.0)
        canvas_y = 40.0 + norm_y * (canvas_h - 80.0)

    room_label = resolve_room_from_coords(floor, canvas_x, canvas_y, custom_rooms)
    return round(canvas_x, 1), round(canvas_y, 1), room_label

def canvas_to_gps(
    x: float,
    y: float,
    bounds: Optional[Any] = None,
    canvas_w: float = 860.0,
    canvas_h: float = 560.0,
) -> Tuple[float, float]:
    """
    Transforms 2D canvas (x, y) coordinates to GPS WGS84 (latitude, longitude)
    matching the bilinear interpolation in mapGeo.ts.
    """
    u = max(0.0, min(1.0, (x - 40.0) / (canvas_w - 80.0)))
    v = max(0.0, min(1.0, (y - 40.0) / (canvas_h - 80.0)))

    corners = _get_bounds_corners(bounds)
    if (
        corners and 
        corners.get("nw") and corners.get("ne") and 
        corners.get("se") and corners.get("sw")
    ):
        nw = corners["nw"]
        ne = corners["ne"]
        se = corners["se"]
        sw = corners["sw"]

        lat = (
            (1.0 - u) * (1.0 - v) * nw[0] +
            u * (1.0 - v) * ne[0] +
            u * v * se[0] +
            (1.0 - u) * v * sw[0]
        )
        lon = (
            (1.0 - u) * (1.0 - v) * nw[1] +
            u * (1.0 - v) * ne[1] +
            u * v * se[1] +
            (1.0 - u) * v * sw[1]
        )
    else:
        b_north = getattr(bounds, "north", None) if not isinstance(bounds, dict) else bounds.get("north")
        b_south = getattr(bounds, "south", None) if not isinstance(bounds, dict) else bounds.get("south")
        b_west = getattr(bounds, "west", None) if not isinstance(bounds, dict) else bounds.get("west")
        b_east = getattr(bounds, "east", None) if not isinstance(bounds, dict) else bounds.get("east")

        if b_north is not None and b_south is not None and b_west is not None and b_east is not None:
            lat = float(b_north) - v * (float(b_north) - float(b_south))
            lon = float(b_west) + u * (float(b_east) - float(b_west))
        else:
            lat = BUILDING_GEO_ANCHORS["lat_top"] - v * (BUILDING_GEO_ANCHORS["lat_top"] - BUILDING_GEO_ANCHORS["lat_bottom"])
            lon = BUILDING_GEO_ANCHORS["lon_left"] + u * (BUILDING_GEO_ANCHORS["lon_right"] - BUILDING_GEO_ANCHORS["lon_left"])

    return round(lat, 7), round(lon, 7)

def infer_floor_from_altitude(
    altitude: Optional[float],
    ground_altitude: Optional[float] = None,
    floor_height_m: float = 3.5,
) -> Tuple[Optional[int], Optional[str]]:
    """
    Infers floor level (1 or 2) from GPS altitude in meters above sea level.
    Returns: (floor: 1 | 2, reason_text)
    """
    if altitude is None:
        return None, None
    ground = ground_altitude if ground_altitude is not None else BUILDING_GEO_ANCHORS["ground_altitude"]
    diff = altitude - ground
    if diff >= floor_height_m:
        return 2, f"GPS Alt {altitude:.1f}m (+{diff:.1f}m เหนือพื้น) -> ชั้น 2"
    return 1, f"GPS Alt {altitude:.1f}m (+{diff:.1f}m เหนือพื้น) -> ชั้น 1"

MIN_DEVICE_DIST = 52.0

def resolve_room_from_coords(
    floor: int,
    x: float,
    y: float,
    custom_rooms: Optional[Dict[int, List[Any]]] = None,
) -> Optional[str]:
    """
    Classifies a coordinate into a named room/zone on the given floor.
    Strictly uses user-configured rooms if provided.
    """
    if custom_rooms is not None:
        floor_rooms = custom_rooms.get(floor, []) or custom_rooms.get(str(floor), [])
    else:
        floor_rooms = ROOMS.get(floor, [])

    for r in floor_rooms:
        r_left = r.get("left") if isinstance(r, dict) else getattr(r, "left", 0)
        r_top = r.get("top") if isinstance(r, dict) else getattr(r, "top", 0)
        r_width = r.get("width") if isinstance(r, dict) else getattr(r, "width", 0)
        r_height = r.get("height") if isinstance(r, dict) else getattr(r, "height", 0)
        r_label = r.get("label") if isinstance(r, dict) else getattr(r, "label", "")

        if (r_left <= x <= r_left + r_width and 
            r_top <= y <= r_top + r_height):
            return r_label

    return None

def pick_smart_spot(
    placed_devices: List[dict],
    floor: int,
    dtype: str = "switch",
    custom_rooms: Optional[Dict[int, List[Any]]] = None,
) -> Tuple[float, float, Optional[str]]:
    """
    Finds an optimal, non-overlapping coordinate strictly within user-configured rooms for that floor.
    If no rooms are configured for this floor, places in canvas center and returns None for room.
    """
    dtype = dtype.lower()
    if custom_rooms is not None:
        floor_rooms = custom_rooms.get(floor, []) or custom_rooms.get(str(floor), [])
    else:
        floor_rooms = ROOMS.get(floor, ROOMS[1])

    if not floor_rooms:
        # Strictly no rooms configured on this floor -> Do NOT invent ghost room names
        return 450.0, 300.0, None

    on_floor = [
        d for d in placed_devices 
        if d.get("floor") == floor and d.get("x") is not None and d.get("y") is not None
    ]

    room_dicts = []
    for r in floor_rooms:
        room_dicts.append({
            "label": r.get("label") if isinstance(r, dict) else getattr(r, "label", ""),
            "left": float(r.get("left") if isinstance(r, dict) else getattr(r, "left", 0)),
            "top": float(r.get("top") if isinstance(r, dict) else getattr(r, "top", 0)),
            "width": float(r.get("width") if isinstance(r, dict) else getattr(r, "width", 0)),
            "height": float(r.get("height") if isinstance(r, dict) else getattr(r, "height", 0)),
            "type": r.get("type") if isinstance(r, dict) else getattr(r, "type", "room"),
        })

    # Prioritize server room / network core for servers, switches, and routers
    primary_rooms = []
    if dtype in ("server", "switch", "router"):
        for r in room_dicts:
            if "server" in r["label"].lower() or "core" in r["label"].lower() or r.get("type") in ("server", "core"):
                primary_rooms.append(r)
    elif dtype == "ap":
        for r in room_dicts:
            if any(k in r["label"].lower() for k in ["office", "meeting", "zone", "lab"]):
                primary_rooms.append(r)

    other_rooms = [r for r in room_dicts if r not in primary_rooms]
    candidate_rooms = primary_rooms + other_rooms if (primary_rooms or other_rooms) else room_dicts

    padding = 24
    step = 40

    for room in candidate_rooms:
        r_left = int(room["left"] + padding)
        r_right = int(room["left"] + room["width"] - padding)
        r_top = int(room["top"] + padding)
        r_bottom = int(room["top"] + room["height"] - padding)

        if r_right < r_left:
            r_left = int(room["left"] + room["width"] / 2)
            r_right = r_left
        if r_bottom < r_top:
            r_top = int(room["top"] + room["height"] / 2)
            r_bottom = r_top

        for gy in range(r_top, r_bottom + 1, step):
            for gx in range(r_left, r_right + 1, step):
                conflict = False
                for d in on_floor:
                    dx = d["x"] - gx
                    dy = d["y"] - gy
                    if math.hypot(dx, dy) < MIN_DEVICE_DIST:
                        conflict = True
                        break
                if not conflict:
                    return float(gx), float(gy), room["label"]

    # Fallback to the center of the first configured room
    first_room = candidate_rooms[0]
    return (
        float(first_room["left"] + first_room["width"] / 2),
        float(first_room["top"] + first_room["height"] / 2),
        first_room["label"]
    )

def pick_free_spot(placed_devices: List[dict], floor: int) -> Tuple[float, float]:
    """
    Backward-compatible helper.
    """
    x, y, _ = pick_smart_spot(placed_devices, floor, "switch")
    return x, y
