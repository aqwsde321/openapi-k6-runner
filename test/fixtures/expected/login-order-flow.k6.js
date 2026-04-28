import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || "https://api.fixture.local";

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;
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

function logFailedCheck(stepId, condition, url, response) {
  console.error(JSON.stringify({
    type: 'openapi-k6-check-failed',
    step: stepId,
    condition,
    status: response.status,
    url,
    responseBody: truncateLogValue(response.body, 2000),
  }, null, 2));
}

export default function () {
  const context = {};

  const url0 = joinUrl(BASE_URL, `/auth/login`);
  const body0 = JSON.stringify({ "username": __ENV.LOGIN_ID, "password": __ENV.LOGIN_PASSWORD });
  const params0 = { headers: { "Content-Type": "application/json" } };
  const res0 = http.post(url0, body0, params0);
  const check0 = check(res0, {
    "login status == 200": (res) => res.status === 200,
  });
  if (!check0) {
    logFailedCheck("login", "status == 200", url0, res0);
  }
  const res0Json = res0.json();
  context.token = readJsonPath(res0Json, ["token"]);

  const url1 = joinUrl(BASE_URL, `/orders`);
  const body1 = JSON.stringify({ "sku": "SKU-001", "quantity": 1 });
  const params1 = { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.token}` } };
  const res1 = http.post(url1, body1, params1);
  const check1 = check(res1, {
    "create-order status == 201": (res) => res.status === 201,
  });
  if (!check1) {
    logFailedCheck("create-order", "status == 201", url1, res1);
  }
  const res1Json = res1.json();
  context.orderId = readJsonPath(res1Json, ["data","id"]);

  let url2 = joinUrl(BASE_URL, `/orders/${encodeURIComponent(String(context.orderId))}`);
  url2 = appendQuery(url2, { "includeItems": true });
  const params2 = { headers: { "Authorization": `Bearer ${context.token}` } };
  const res2 = http.get(url2, params2);
  const check2 = check(res2, {
    "get-order status < 300": (res) => res.status < 300,
  });
  if (!check2) {
    logFailedCheck("get-order", "status < 300", url2, res2);
  }
}
