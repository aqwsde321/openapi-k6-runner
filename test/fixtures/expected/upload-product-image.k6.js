import http from 'k6/http';
import { check, group } from 'k6';

const BASE_URL = __ENV.BASE_URL || "https://api.fixture.local";
const OPENAPI_K6_TRACE = __ENV.OPENAPI_K6_TRACE === '1';
const multipartFile0_0 = open("../fixtures/product.png", 'b');

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

  group("upload-image POST /products/{productId}/image", () => {
    const metadata0 = { "scenario": "upload-product-image", "step": "upload-image", "method": "POST", "path": "/products/{productId}/image" };
    const tags0 = { "openapi_scenario": "upload-product-image", "openapi_step": "upload-image", "openapi_method": "POST", "openapi_path": "/products/{productId}/image", "openapi_api": "POST /products/{productId}/image" };
    const url0 = joinUrl(BASE_URL, `/products/${encodeURIComponent(String("product-001"))}/image`);
    const body0 = { "title": "Main image", "image": http.file(multipartFile0_0, "product.png", "image/png") };
    const params0 = { headers: { "Authorization": `Bearer ${__ENV.API_TOKEN}` }, tags: tags0 };
    logStepStart(metadata0, url0);
    const res0 = http.post(url0, body0, params0);
    logStepEnd(metadata0, res0);
    const check0 = check(res0, {
      "upload-image status == 200": (res) => res.status === 200,
    });
    if (!check0) {
      logFailedCheck(metadata0, "status == 200", url0, res0);
    }
  });
}
