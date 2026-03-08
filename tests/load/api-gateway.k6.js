import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  stages: [
    { duration: "30s", target: 10 },  // Warm up
    { duration: "1m", target: 50 },   // Ramp up
    { duration: "1m", target: 100 },  // Peak load
    { duration: "30s", target: 0 },   // Cool down
  ],
  thresholds: {
    http_req_duration: [
      "p(95)<500",   // 95% of requests under 500ms
      "p(99)<1500",  // 99% of requests under 1.5s
    ],
    http_req_failed: ["rate<0.01"], // Error rate under 1%
  },
};

// Login once to get auth token
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: __ENV.TEST_EMAIL || "admin@demo.nexcrm.com",
      password: __ENV.TEST_PASSWORD || "demo123",
      tenantSlug: __ENV.TEST_TENANT || "demo",
    }),
    { headers: { "Content-Type": "application/json" } }
  );

  const body = loginRes.json();
  const token = body.data?.accessToken || body.accessToken || "";
  return { token };
}

export default function (data) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  // GET contacts list
  {
    const res = http.get(`${BASE_URL}/api/v1/contacts?page=1&limit=20`, {
      headers,
      tags: { endpoint: "contacts_list" },
    });
    check(res, {
      "contacts: status 200": (r) => r.status === 200,
      "contacts: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);

  // GET pipeline deals
  {
    const res = http.get(`${BASE_URL}/api/v1/pipeline?page=1&limit=50`, {
      headers,
      tags: { endpoint: "pipeline_list" },
    });
    check(res, {
      "pipeline: status 200": (r) => r.status === 200,
      "pipeline: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);

  // GET companies
  {
    const res = http.get(`${BASE_URL}/api/v1/companies?page=1&limit=20`, {
      headers,
      tags: { endpoint: "companies_list" },
    });
    check(res, {
      "companies: status 200": (r) => r.status === 200,
      "companies: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);

  // GET activities
  {
    const res = http.get(`${BASE_URL}/api/v1/activities?page=1&limit=20`, {
      headers,
      tags: { endpoint: "activities_list" },
    });
    check(res, {
      "activities: status 200": (r) => r.status === 200,
      "activities: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(1);
}
