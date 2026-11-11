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
    status          TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
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

CREATE INDEX poll_runs_device_started_idx ON poll_runs (device_id, started_at DESC);
CREATE INDEX interface_samples_sampled_at_idx ON interface_samples (sampled_at DESC);
CREATE INDEX device_metric_samples_name_time_idx ON device_metric_samples (device_id, metric_name, sampled_at DESC);
CREATE INDEX device_metric_samples_labels_idx ON device_metric_samples USING GIN (labels);
