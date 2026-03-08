import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: [
      "p(95)<500",
      "p(99)<1500",
    ],
    http_req_failed: ["rate<0.01"],
  },
};

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
  return { token: body.data?.accessToken || body.accessToken || "" };
}

const queries = {
  dashboardKPIs: `
    query DashboardKPIs {
      dashboardKPIs {
        totalContacts
        totalDeals
        totalRevenue
        conversionRate
      }
    }
  `,
  contactsList: `
    query Contacts($page: Int, $limit: Int) {
      contacts(page: $page, limit: $limit) {
        items { id firstName lastName email company }
        total
        page
      }
    }
  `,
  pipelineDeals: `
    query PipelineDeals {
      deals {
        items { id title value stage probability }
        total
      }
    }
  `,
};

export default function (data) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.token}`,
  };

  // Dashboard KPIs
  {
    const res = http.post(
      `${BASE_URL}/graphql`,
      JSON.stringify({ query: queries.dashboardKPIs }),
      { headers, tags: { endpoint: "graphql_kpis" } }
    );
    check(res, {
      "KPIs: status 200": (r) => r.status === 200,
      "KPIs: no errors": (r) => !r.json().errors,
      "KPIs: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);

  // Contacts list
  {
    const res = http.post(
      `${BASE_URL}/graphql`,
      JSON.stringify({
        query: queries.contactsList,
        variables: { page: 1, limit: 20 },
      }),
      { headers, tags: { endpoint: "graphql_contacts" } }
    );
    check(res, {
      "Contacts GQL: status 200": (r) => r.status === 200,
      "Contacts GQL: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(0.5);

  // Pipeline deals
  {
    const res = http.post(
      `${BASE_URL}/graphql`,
      JSON.stringify({ query: queries.pipelineDeals }),
      { headers, tags: { endpoint: "graphql_deals" } }
    );
    check(res, {
      "Deals GQL: status 200": (r) => r.status === 200,
      "Deals GQL: response < 500ms": (r) => r.timings.duration < 500,
    });
  }

  sleep(1);
}
