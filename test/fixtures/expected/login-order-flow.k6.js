import http from 'k6/http';
import { check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || "https://api.fixture.local";
const OPENAPI_K6_TRACE = __ENV.OPENAPI_K6_TRACE === '1';

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;
}

function logStepStart(metadata, url) {
  if (!OPENAPI_K6_TRACE) {
    return;
  }

  console.log(JSON.stringify({
    type: 'openapi-k6-step-start',
    scenario: metadata.scenario,
    step: metadata.step,
    method: metadata.method,
    path: metadata.path,
    url,
  }));
}

function logStepEnd(metadata, response) {
  if (!OPENAPI_K6_TRACE) {
    return;
  }

  console.log(JSON.stringify({
    type: 'openapi-k6-step-end',
    scenario: metadata.scenario,
    step: metadata.step,
    method: metadata.method,
    path: metadata.path,
    status: response.status,
    durationMs: response.timings.duration,
  }));
}

function appendQuery(url, query) {
  const search = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .flatMap(([key, value]) => Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

  return search ? `${url}${url.includes('?') ? '&' : '?'}${search}` : url;
}

function readJsonPath(value, path) {
  return path.reduce((current, key) => current == null ? undefined : current[key], value);
}

function truncateLogValue(value, limit) {
  if (value === undefined || value === null) {
    return value;
  }

  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit)}...<truncated ${text.length - limit} chars>` : text;
}

function logFailedCheck(metadata, condition, url, response) {
  console.error(JSON.stringify({
    type: 'openapi-k6-check-failed',
    scenario: metadata.scenario,
    step: metadata.step,
    method: metadata.method,
    path: metadata.path,
    condition,
    status: response.status,
    url,
    durationMs: response.timings.duration,
    responseBody: truncateLogValue(response.body, 2000),
  }, null, 2));
}

export default function () {
  const context = {};

  group("login POST /auth/login", () => {
    const metadata0 = { "scenario": "login-order-flow", "step": "login", "method": "POST", "path": "/auth/login" };
    const tags0 = { "openapi_scenario": "login-order-flow", "openapi_step": "login", "openapi_method": "POST", "openapi_path": "/auth/login", "openapi_api": "POST /auth/login" };
    const url0 = joinUrl(BASE_URL, `/auth/login`);
    const body0 = JSON.stringify({ "username": __ENV.LOGIN_ID, "password": __ENV.LOGIN_PASSWORD });
    const params0 = { headers: { "Content-Type": "application/json" }, tags: tags0 };
    logStepStart(metadata0, url0);
    const res0 = http.post(url0, body0, params0);
    logStepEnd(metadata0, res0);
    const check0 = check(res0, {
      "login status == 200": (res) => res.status === 200,
    });
    if (!check0) {
      logFailedCheck(metadata0, "status == 200", url0, res0);
    }
    const res0Json = res0.json();
    context.token = readJsonPath(res0Json, ["token"]);
  });

  group("create-order POST /orders", () => {
    const metadata1 = { "scenario": "login-order-flow", "step": "create-order", "method": "POST", "path": "/orders" };
    const tags1 = { "openapi_scenario": "login-order-flow", "openapi_step": "create-order", "openapi_method": "POST", "openapi_path": "/orders", "openapi_api": "POST /orders" };
    const url1 = joinUrl(BASE_URL, `/orders`);
    const body1 = JSON.stringify({ "sku": "SKU-001", "quantity": 1 });
    const params1 = { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.token}` }, tags: tags1 };
    logStepStart(metadata1, url1);
    const res1 = http.post(url1, body1, params1);
    logStepEnd(metadata1, res1);
    const check1 = check(res1, {
      "create-order status == 201": (res) => res.status === 201,
    });
    if (!check1) {
      logFailedCheck(metadata1, "status == 201", url1, res1);
    }
    const res1Json = res1.json();
    context.orderId = readJsonPath(res1Json, ["data","id"]);
  });

  group("get-order GET /orders/{orderId}", () => {
    const metadata2 = { "scenario": "login-order-flow", "step": "get-order", "method": "GET", "path": "/orders/{orderId}" };
    const tags2 = { "openapi_scenario": "login-order-flow", "openapi_step": "get-order", "openapi_method": "GET", "openapi_path": "/orders/{orderId}", "openapi_api": "GET /orders/{orderId}" };
    let url2 = joinUrl(BASE_URL, `/orders/${encodeURIComponent(String(context.orderId))}`);
    url2 = appendQuery(url2, { "includeItems": true });
    const params2 = { headers: { "Authorization": `Bearer ${context.token}` }, tags: tags2 };
    logStepStart(metadata2, url2);
    const res2 = http.get(url2, params2);
    logStepEnd(metadata2, res2);
    const check2 = check(res2, {
      "get-order status < 300": (res) => res.status < 300,
    });
    if (!check2) {
      logFailedCheck(metadata2, "status < 300", url2, res2);
    }
  });
}
