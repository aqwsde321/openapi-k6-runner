import { describe, expect, it } from 'vitest';

import {
  collectReportFailures,
  formatReportFailuresForCopy,
  getReportScenarios,
  normalizeUiReport,
  reportIdFromPath,
  reportScenarioHasFailure,
  type UiReportDetail,
} from '../src/cli/ui/app/report-view.js';

describe('React UI reports', () => {
  const report: UiReportDetail = {
    result: 'FAIL',
    scenarios: [
      {
        key: 'failed',
        name: 'failed scenario',
        result: 'FAIL',
        steps: [{
          id: 'request',
          result: 'FAIL',
          method: 'POST',
          path: '/orders',
          response: { status: 500, statusText: 'Error' },
          condition: { expression: 'status == 201', passed: false },
          extracts: [],
        }],
      },
      { key: 'passed', result: 'PASS', steps: [] },
    ],
  };

  it('실패 시나리오만 필터링하고 실패 원인을 복사 가능한 텍스트로 만든다', () => {
    expect(getReportScenarios(report, true).map((scenario) => scenario.key)).toEqual(['failed']);
    const failures = collectReportFailures(report);
    expect(failures).toEqual([expect.objectContaining({
      scenario: 'failed scenario',
      step: 'request',
      request: 'POST /orders',
      actual: 'HTTP 500 Error',
      expected: 'status == 201',
    })]);
    expect(formatReportFailuresForCopy(failures)).toBe(
      'failed scenario · request · POST /orders · actual HTTP 500 Error · expected status == 201',
    );
  });

  it('이전 리포트의 누락 필드와 다른 OS 경로를 안전하게 처리한다', () => {
    expect(getReportScenarios({}, false)).toEqual([]);
    expect(collectReportFailures({ scenarios: [{ name: 'old report' }] })).toEqual([]);
    expect(reportScenarioHasFailure({ result: 'PASS', steps: [{ error: 'network' }] })).toBe(true);
    expect(reportIdFromPath('openapi-k6/reports/run.json')).toBe('run.json');
    expect(reportIdFromPath('openapi-k6\\reports\\run.json')).toBe('run.json');
    expect(normalizeUiReport({
      result: 'PASS',
      scenarios: [null, { name: 'valid', steps: 'invalid' }],
      summary: 'invalid',
    })).toMatchObject({
      result: 'PASS',
      scenarios: [{ name: 'valid', steps: [] }],
      summary: { scenarios: {}, steps: {} },
    });
  });

  it('extract 실패의 이름과 경로와 오류를 보존한다', () => {
    const failures = collectReportFailures({
      scenarios: [{
        key: 'extract',
        steps: [{
          id: 'read-token',
          extracts: [{
            name: 'token',
            path: '$.data.token',
            passed: false,
            error: '값을 찾지 못했습니다.',
          }],
        }],
      }],
    });

    expect(failures).toEqual([expect.objectContaining({
      scenario: 'extract',
      step: 'read-token',
      expected: 'extract token @ $.data.token',
      error: '값을 찾지 못했습니다.',
    })]);
  });
});
