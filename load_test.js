import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Custom Metrics
const healthLatency = new Trend('health_latency_ms');
const devicesLatency = new Trend('devices_latency_ms');
const alertsLatency = new Trend('alerts_latency_ms');
const errorRate = new Rate('custom_error_rate');

export const options = {
  stages: [
    { duration: '2s', target: 5 },   // Ramp-up to 5 VUs
    { duration: '5s', target: 15 },  // Peak load: 15 VUs concurrent
    { duration: '2s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],             // Error rate < 1%
    http_req_duration: ['p(95)<150'],           // 95% of requests under 150ms
    health_latency_ms: ['p(95)<50'],            // Health check under 50ms
    devices_latency_ms: ['p(95)<100'],          // DB devices query under 100ms
    custom_error_rate: ['rate<0.01'],
  },
};

const BASE_URL = 'http://127.0.0.1:8000';

export default function () {
  // 1. Health Check
  group('1. Health Check', function () {
    const res = http.get(`${BASE_URL}/health`, {
      tags: { name: 'HealthCheck' },
    });
    healthLatency.add(res.timings.duration);

    const success = check(res, {
      'health status is 200': (r) => r.status === 200,
      'db is connected': (r) => {
        try {
          return JSON.parse(r.body).db === true;
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.1);

  // 2. Fetch Devices List (PostgreSQL Query)
  group('2. Devices List', function () {
    const res = http.get(`${BASE_URL}/api/v1/devices`, {
      tags: { name: 'GetDevices' },
    });
    devicesLatency.add(res.timings.duration);

    const success = check(res, {
      'devices status is 200': (r) => r.status === 200,
      'has devices array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body) && body.length > 0;
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.1);

  // 3. Fetch Alerts List
  group('3. Alerts List', function () {
    const res = http.get(`${BASE_URL}/api/v1/alerts`, {
      tags: { name: 'GetAlerts' },
    });
    alertsLatency.add(res.timings.duration);

    const success = check(res, {
      'alerts status is 200': (r) => r.status === 200,
      'has alerts array': (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.1);

  // 4. Fetch Single Device Detail
  group('4. Device Detail (ID: 1)', function () {
    const res = http.get(`${BASE_URL}/api/v1/devices/1`, {
      tags: { name: 'GetDeviceDetail' },
    });

    const success = check(res, {
      'device detail status is 200': (r) => r.status === 200,
      'device id is 1': (r) => {
        try {
          return String(JSON.parse(r.body).device.id) === '1';
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!success);
  });

  sleep(0.2);
}
