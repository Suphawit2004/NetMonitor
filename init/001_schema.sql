CREATE TABLE devices (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            TEXT NOT NULL,
    hostname        TEXT NOT NULL,
    management_ip   INET NOT NULL,
    snmp_port       INTEGER NOT NULL DEFAULT 161 CHECK (snmp_port BETWEEN 1 AND 65535),
    snmp_version    TEXT NOT NULL CHECK (snmp_version IN ('v1', 'v2c', 'v3')),
    credential_ref  TEXT,
    poll_interval_s INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_s > 0),
    location        TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    dtype           TEXT NOT NULL DEFAULT 'switch',
    floor           INTEGER NOT NULL DEFAULT 1,
    x               DOUBLE PRECISION,
    y               DOUBLE PRECISION,
    locked          BOOLEAN NOT NULL DEFAULT true,
    model           TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    altitude        DOUBLE PRECISION,
    services        JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_simulated    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (management_ip, snmp_port)
);

CREATE TABLE interfaces (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    if_index        INTEGER NOT NULL CHECK (if_index >= 0),
    name            TEXT NOT NULL,
    description     TEXT,
    mac_address     TEXT,
    speed_bps       BIGINT CHECK (speed_bps >= 0),
    admin_status    TEXT,
    oper_status     TEXT,
    discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (device_id, if_index)
);

CREATE TABLE poll_runs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'warning')),
    error_message   TEXT
);

CREATE TABLE interface_samples (
    interface_id    BIGINT NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
    sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    in_octets       NUMERIC(20, 0),
    out_octets      NUMERIC(20, 0),
    in_errors       BIGINT,
    out_errors      BIGINT,
    in_discards     BIGINT,
    out_discards    BIGINT,
    PRIMARY KEY (interface_id, sampled_at)
);

CREATE TABLE device_metric_samples (
    device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    oid             TEXT NOT NULL,
    metric_name     TEXT NOT NULL,
    numeric_value   DOUBLE PRECISION,
    text_value      TEXT,
    labels          JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (device_id, sampled_at, oid, labels)
);

CREATE TABLE alerts (
    id              SERIAL PRIMARY KEY,
    device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    severity        VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warn', 'crit')),
    icon            VARCHAR(50) DEFAULT '',
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by VARCHAR(100)
);

CREATE TABLE topology_links (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_device_id    BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    target_device_id    BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    source_port         TEXT,
    target_port         TEXT,
    link_type           TEXT NOT NULL DEFAULT 'uplink' CHECK (link_type IN ('wan', 'uplink', 'trunk', 'access', 'redundancy')),
    bandwidth_mbps      INTEGER NOT NULL DEFAULT 1000 CHECK (bandwidth_mbps > 0),
    is_redundant        BOOLEAN NOT NULL DEFAULT FALSE,
    auto_inferred       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (source_device_id <> target_device_id),
    UNIQUE (source_device_id, target_device_id, source_port)
);

CREATE TABLE floor_layouts (
    floor           INTEGER PRIMARY KEY CHECK (floor IN (1, 2)),
    rooms           JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX poll_runs_device_started_idx ON poll_runs (device_id, started_at DESC);
CREATE INDEX interface_samples_sampled_at_idx ON interface_samples (sampled_at DESC);
CREATE INDEX device_metric_samples_name_time_idx ON device_metric_samples (device_id, metric_name, sampled_at DESC);
CREATE INDEX device_metric_samples_labels_idx ON device_metric_samples USING GIN (labels);
CREATE INDEX idx_alerts_device_id ON alerts (device_id);
CREATE INDEX idx_alerts_created_at ON alerts (created_at DESC);
CREATE INDEX idx_devices_floor ON devices (floor);
CREATE INDEX idx_devices_enabled ON devices (enabled);
CREATE INDEX idx_topology_links_source ON topology_links (source_device_id);
CREATE INDEX idx_topology_links_target ON topology_links (target_device_id);
