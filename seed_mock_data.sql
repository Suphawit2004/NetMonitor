-- Seed Mock Data for NetMonitor PostgreSQL Database (netmon)

BEGIN;

-- 1. Insert Devices
INSERT INTO devices (name, hostname, management_ip, snmp_port, snmp_version, credential_ref, poll_interval_s, location, enabled, dtype, floor, x, y, locked, model)
VALUES
    ('SW-CORE-01', 'sw-core-01.corp.local', '10.0.0.1', 161, 'v2c', 'public', 30, 'Building A - Floor 1 - Server Room', true, 'switch', 1, 96.0, 98.0, true, 'Cisco Catalyst 9500'),
    ('SW-DIST-01', 'sw-dist-01.corp.local', '10.0.0.5', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Network Core', true, 'switch', 1, 280.0, 98.0, true, 'Cisco Catalyst 9300-48P'),
    ('RTR-01',     'rtr-01.corp.local',     '192.168.1.1', 161, 'v2c', 'public', 30, 'Building A - Floor 1 - Network Core', true, 'router', 1, 335.0, 98.0, true, 'Cisco ISR 4451'),
    ('SRV-01',     'srv-01.corp.local',     '10.0.1.10', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Server Room', true, 'server', 1, 50.0, 50.0, true, 'Dell PowerEdge R750'),
    ('SRV-02',     'srv-02.corp.local',     '10.0.1.11', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Server Room', true, 'server', 1, 140.0, 50.0, true, 'Dell PowerEdge R750'),
    ('SW-B1',      'sw-b1.corp.local',      '10.0.0.10', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone B Meeting', true, 'switch', 1, 100.0, 250.0, true, 'Cisco Catalyst 2960'),
    ('SW-C1',      'sw-c1.corp.local',      '10.0.0.20', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone C Lab', true, 'switch', 1, 450.0, 250.0, true, 'Cisco Catalyst 2960'),
    ('SW-IT1',     'sw-it1.corp.local',     '10.0.0.30', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - IT Office', false, 'switch', 1, 100.0, 420.0, true, 'Cisco Catalyst 2960'),
    ('AP-A1',      'ap-a1.corp.local',      '10.1.0.1',  161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone A Office', true, 'ap', 1, 500.0, 98.0, true, 'Aruba AP-505'),
    ('AP-A2',      'ap-a2.corp.local',      '10.1.0.2',  161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone A Office', true, 'ap', 1, 650.0, 98.0, true, 'Aruba AP-505'),
    ('AP-B1',      'ap-b1.corp.local',      '10.1.0.10', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone B Meeting', true, 'ap', 1, 250.0, 250.0, true, 'Aruba AP-505'),
    ('AP-C1',      'ap-c1.corp.local',      '10.1.0.20', 161, 'v2c', 'public', 60, 'Building A - Floor 1 - Zone C Lab', true, 'ap', 1, 600.0, 250.0, true, 'Aruba AP-505')
ON CONFLICT (management_ip, snmp_port) DO NOTHING;

-- 2. Insert Interfaces for Core Switch (SW-CORE-01)
INSERT INTO interfaces (device_id, if_index, name, description, mac_address, speed_bps, admin_status, oper_status)
SELECT d.id, i.idx, i.if_name, i.if_desc, i.mac, i.speed, i.adm, i.oper
FROM devices d
CROSS JOIN (
    VALUES
        (1, 'TenGigabitEthernet1/1/1', 'Uplink to RTR-01', '00:1A:2B:3C:4D:01', 10000000000::bigint, 'up', 'up'),
        (2, 'TenGigabitEthernet1/1/2', 'Trunk to SW-DIST-01', '00:1A:2B:3C:4D:02', 10000000000::bigint, 'up', 'up'),
        (3, 'GigabitEthernet1/0/1',    'Link to SRV-01 NIC1', '00:1A:2B:3C:4D:03', 1000000000::bigint,  'up', 'up'),
        (4, 'GigabitEthernet1/0/2',    'Link to SRV-02 NIC1', '00:1A:2B:3C:4D:04', 1000000000::bigint,  'up', 'up'),
        (5, 'GigabitEthernet1/0/3',    'Backup Link to SW-B1', '00:1A:2B:3C:4D:05', 1000000000::bigint, 'up', 'down'),
        (6, 'GigabitEthernet1/0/4',    'Reserved Port', '00:1A:2B:3C:4D:06', 1000000000::bigint,        'down', 'down')
) AS i(idx, if_name, if_desc, mac, speed, adm, oper)
WHERE d.name = 'SW-CORE-01'
ON CONFLICT (device_id, if_index) DO NOTHING;

-- Insert Interfaces for Router (RTR-01)
INSERT INTO interfaces (device_id, if_index, name, description, mac_address, speed_bps, admin_status, oper_status)
SELECT d.id, i.idx, i.if_name, i.if_desc, i.mac, i.speed, i.adm, i.oper
FROM devices d
CROSS JOIN (
    VALUES
        (1, 'GigabitEthernet0/0/0', 'WAN Fiber Internet (ISP-1)', '00:50:56:A1:B2:01', 1000000000::bigint, 'up', 'up'),
        (2, 'GigabitEthernet0/0/1', 'WAN Backup 5G (ISP-2)',     '00:50:56:A1:B2:02', 1000000000::bigint, 'up', 'up'),
        (3, 'TenGigabitEthernet0/1/0', 'LAN Downlink to SW-CORE-01', '00:50:56:A1:B2:03', 10000000000::bigint, 'up', 'up')
) AS i(idx, if_name, if_desc, mac, speed, adm, oper)
WHERE d.name = 'RTR-01'
ON CONFLICT (device_id, if_index) DO NOTHING;

-- 3. Insert Poll Runs
INSERT INTO poll_runs (device_id, started_at, finished_at, status, error_message)
SELECT id, now() - INTERVAL '1 minute', now() - INTERVAL '58 second', 'succeeded', NULL
FROM devices
WHERE enabled = true;

INSERT INTO poll_runs (device_id, started_at, finished_at, status, error_message)
SELECT id, now() - INTERVAL '2 minute', now() - INTERVAL '1 minute 50 second', 'failed', 'SNMP Request Timeout (No response from agent)'
FROM devices
WHERE enabled = false;

-- 4. Insert Interface Samples (Traffic)
INSERT INTO interface_samples (interface_id, sampled_at, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards)
SELECT 
    i.id, 
    now() - (s.n * INTERVAL '30 second'), 
    (54000000000 + (s.n * 142000000))::numeric(20, 0),
    (28000000000 + (s.n * 89000000))::numeric(20, 0),
    0, 
    0, 
    0, 
    0
FROM interfaces i
CROSS JOIN generate_series(0, 10) AS s(n)
ON CONFLICT (interface_id, sampled_at) DO NOTHING;

-- 5. Insert Device Metric Samples (CPU, Memory, Temperature)
INSERT INTO device_metric_samples (device_id, sampled_at, oid, metric_name, numeric_value, text_value, labels)
SELECT 
    d.id, 
    now() - (s.n * INTERVAL '1 minute'), 
    '.1.3.6.1.4.1.9.9.109.1.1.1.1.5.1', 
    'cpu_usage_percent', 
    CASE WHEN d.name = 'SW-CORE-01' THEN 24.5 + s.n * 0.8
         WHEN d.name = 'RTR-01' THEN 42.0 + s.n * 1.2
         ELSE 15.0 + s.n * 0.5 END,
    NULL,
    '{"unit": "%", "core": "all"}'::jsonb
FROM devices d
CROSS JOIN generate_series(0, 5) AS s(n)
WHERE d.enabled = true
ON CONFLICT (device_id, sampled_at, oid, labels) DO NOTHING;

INSERT INTO device_metric_samples (device_id, sampled_at, oid, metric_name, numeric_value, text_value, labels)
SELECT 
    d.id, 
    now() - (s.n * INTERVAL '1 minute'), 
    '.1.3.6.1.4.1.9.9.48.1.1.1.5.1', 
    'memory_usage_percent', 
    58.2 + s.n * 0.3,
    NULL,
    '{"unit": "%", "pool": "Processor"}'::jsonb
FROM devices d
CROSS JOIN generate_series(0, 5) AS s(n)
WHERE d.enabled = true
ON CONFLICT (device_id, sampled_at, oid, labels) DO NOTHING;

INSERT INTO device_metric_samples (device_id, sampled_at, oid, metric_name, numeric_value, text_value, labels)
SELECT 
    d.id, 
    now() - (s.n * INTERVAL '1 minute'), 
    '.1.3.6.1.4.1.9.9.13.1.3.1.3.1', 
    'chassis_temperature_c', 
    41.5 + s.n * 0.2,
    NULL,
    '{"unit": "Celsius", "sensor": "Chassis Intake"}'::jsonb
FROM devices d
CROSS JOIN generate_series(0, 5) AS s(n)
WHERE d.enabled = true
ON CONFLICT (device_id, sampled_at, oid, labels) DO NOTHING;

COMMIT;

