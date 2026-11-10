import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const reqDuration = new Trend('req_duration');
const totalRequests = new Counter('total_reqs');

export const options = {
  stages: [
    { duration: '5s', target: 50 },   // Step 1: 50 VUs
    { duration: '10s', target: 150 }, // Step 2: 150 VUs
    { duration: '10s', target: 300 }, // Step 3: 300 VUs (Stress)
    { duration: '10s', target: 500 }, // Step 4: 500 VUs (Breaking point test)
    { duration: '5s', target: 0 },    // Step 5: Ramp-down & Recovery
  ],
  thresholds: {
    // We don't abort immediately so we can observe the exact failure point
    errors: ['rate<0.10'],
  },
};

const BASE_URL = 'http://127.0.0.1:8000';

export default function () {
  // We alternate between:
  // 1. Database read: GET /api/v1/devices
  // 2. Health check: GET /health
  // 3. Alerts read: GET /api/v1/alerts
  const endpoints = [
    '/api/v1/devices',
    '/health',
    '/api/v1/alerts',
    '/api/v1/devices/1',
  ];

  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${ep}`, {
    timeout: '5s',
  });

  totalRequests.add(1);
  reqDuration.add(res.timings.duration);

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
  });

  if (!ok) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }

  // Small sleep to simulate rapid real-world client interaction
  sleep(0.05);
}
