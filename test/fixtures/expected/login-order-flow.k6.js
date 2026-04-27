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

export default function () {
  const context = {};

  const url0 = joinUrl(BASE_URL, `/auth/login`);
  const body0 = JSON.stringify({ "username": __ENV.LOGIN_ID, "password": __ENV.LOGIN_PASSWORD });
  const params0 = { headers: { "Content-Type": "application/json" } };
  const res0 = http.post(url0, body0, params0);
  const res0Json = res0.json();
  context.token = readJsonPath(res0Json, ["token"]);
  check(res0, {
    "login status == 200": (res) => res.status === 200,
  });

  const url1 = joinUrl(BASE_URL, `/orders`);
  const body1 = JSON.stringify({ "sku": "SKU-001", "quantity": 1 });
  const params1 = { headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.token}` } };
  const res1 = http.post(url1, body1, params1);
  const res1Json = res1.json();
  context.orderId = readJsonPath(res1Json, ["data","id"]);
  check(res1, {
    "create-order status == 201": (res) => res.status === 201,
  });

  let url2 = joinUrl(BASE_URL, `/orders/${context.orderId}`);
  url2 = appendQuery(url2, { "includeItems": true });
  const params2 = { headers: { "Authorization": `Bearer ${context.token}` } };
  const res2 = http.get(url2, params2);
  check(res2, {
    "get-order status < 300": (res) => res.status < 300,
  });
}
