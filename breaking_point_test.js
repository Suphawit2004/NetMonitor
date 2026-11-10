import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const errorRate = new Rate('errors');
const reqDuration = new Trend('req_duration');
const totalRequests = new Counter('total_reqs');

export const options = {
  stages: [
    { duration: '5s', target: 300 },   // Warm-up to 300 VUs
    { duration: '10s', target: 800 },  // Heavy saturation: 800 VUs
    { duration: '10s', target: 1200 }, // Breaking Point Push: 1,200 VUs
    { duration: '5s', target: 0 },     // Ramp-down
  ],
  thresholds: {
    errors: ['rate<0.50'],
  },
};

const BASE_URL = 'http://127.0.0.1:8000';

export default function () {
  const endpoints = [
    '/api/v1/devices',
    '/health',
    '/api/v1/alerts',
    '/api/v1/devices/1',
  ];

  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(`${BASE_URL}${ep}`, {
    timeout: '4s',
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

  sleep(0.02);
}
