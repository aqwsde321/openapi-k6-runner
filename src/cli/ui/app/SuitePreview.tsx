import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';

import type { UiSuiteRunResult } from '../run-state.js';
import type { UiSuiteDetail, UiSuiteListItem } from '../suites.js';
import type { ScenarioRunStatus } from './scenario-runs';
import { reportIdFromPath } from './report-view';

export interface SuitePreviewProps {
  detail?: UiSuiteDetail;
  error?: string;
  item?: UiSuiteListItem;
  loading: boolean;
  onOpenReport(reportId: string): void;
  result?: UiSuiteRunResult;
  status?: ScenarioRunStatus;
}

export function SuitePreview({
  detail,
  error,
  item,
  loading,
  onOpenReport,
  result,
  status,
}: SuitePreviewProps) {
  if (item === undefined) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="왼쪽 탐색에서 확인할 스위트를 선택하세요."
          isCompact
          title="선택된 스위트 없음"
        />
      </VStack>
    );
  }

  const runStatus = formatRunStatus(status, result);
  const reportId = reportIdFromPath(result?.reportPath);
  const passedScenarios = result?.scenarios.filter((scenario) => scenario.status === 'passed').length;

  return (
    <VStack gap={5} padding={6}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Text color="secondary" type="label">스위트</Text>
          {item.scenarioCount !== undefined && <Badge label={`${item.scenarioCount}개`} />}
          <StatusDot
            isPulsing={status === 'starting' || status === 'running'}
            label={runStatus.label}
            variant={runStatus.variant}
          />
          <Text color="secondary" type="supporting">{runStatus.label}</Text>
        </HStack>
        <Heading level={2} maxLines={2}>{item.name}</Heading>
        <Text as="p" color="secondary" type="supporting">
          {item.description ?? item.path}
        </Text>
      </VStack>

      {item.error !== undefined ? (
        <Banner
          container="section"
          description={item.error}
          status="error"
          title="YAML 파싱 오류"
        />
      ) : error !== undefined ? (
        <Banner
          container="section"
          description={error}
          status="error"
          title="스위트 상세를 불러오지 못했습니다"
        />
      ) : loading || detail?.id !== item.id ? (
        <Text color="secondary" type="supporting">스위트 구성 불러오는 중…</Text>
      ) : (
        <VStack gap={4}>
          <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
            <HStack gap={3} wrap="wrap">
              <Text color="secondary" type="supporting">
                시나리오 {passedScenarios === undefined ? '-' : passedScenarios}/
                {result?.scenarios.length ?? detail.scenarioCount}
              </Text>
              {result !== undefined && (
                <Text color="secondary" type="supporting">
                  {formatDuration(result.durationMs)}
                </Text>
              )}
            </HStack>
            {reportId !== undefined && (
              <Button
                clickAction={() => onOpenReport(reportId)}
                label="리포트"
                size="sm"
                variant="secondary"
              />
            )}
          </HStack>

          <List
            density="compact"
            hasDividers
            header={<Text type="label" weight="semibold">포함 시나리오</Text>}
          >
            {detail.scenarios.map((scenario, index) => {
              const scenarioResult = result?.scenarios.find((candidate) => candidate.scenarioKey === scenario.id);
              const scenarioStatus = formatScenarioStatus(scenario.error, scenarioResult?.status);
              return (
                <ListItem
                  key={`${scenario.id}:${index}`}
                  description={(
                    <VStack gap={1}>
                      <Text color="secondary" type="supporting">
                        {formatScenarioMeta(scenario, scenarioResult)}
                      </Text>
                      {formatSuiteFailure(scenarioResult) !== undefined && (
                        <Text color="secondary" type="supporting">
                          {formatSuiteFailure(scenarioResult)}
                        </Text>
                      )}
                      {scenario.error !== undefined && (
                        <Text color="secondary" type="supporting">{scenario.error}</Text>
                      )}
                    </VStack>
                  )}
                  endContent={(
                    <HStack gap={1} vAlign="center">
                      <StatusDot label={scenarioStatus.label} variant={scenarioStatus.variant} />
                      <Text type="supporting">{scenarioStatus.label}</Text>
                    </HStack>
                  )}
                  label={`${index + 1}. ${scenario.name ?? scenario.id}`}
                />
              );
            })}
          </List>
        </VStack>
      )}
    </VStack>
  );
}

function formatRunStatus(
  status: ScenarioRunStatus | undefined,
  result: UiSuiteRunResult | undefined,
): { label: string; variant: StatusDotVariant } {
  if (status === 'starting') return { label: '시작 중', variant: 'accent' };
  if (status === 'running') return { label: '실행 중', variant: 'accent' };
  if (result?.status === 'passed' || status === 'passed') return { label: '성공', variant: 'success' };
  if (result?.status === 'failed' || status === 'failed') return { label: '실패', variant: 'error' };
  return { label: '미실행', variant: 'neutral' };
}

function formatScenarioStatus(
  error: string | undefined,
  status: UiSuiteRunResult['scenarios'][number]['status'] | undefined,
): { label: string; variant: StatusDotVariant } {
  if (error !== undefined) return { label: '오류', variant: 'error' };
  if (status === 'passed') return { label: '성공', variant: 'success' };
  if (status === 'failed') return { label: '실패', variant: 'error' };
  return { label: '준비', variant: 'neutral' };
}

function formatScenarioMeta(
  scenario: UiSuiteDetail['scenarios'][number],
  result: UiSuiteRunResult['scenarios'][number] | undefined,
): string {
  return [
    scenario.id,
    result === undefined
      ? scenario.stepCount === undefined ? undefined : `${scenario.stepCount}단계`
      : `${result.passedSteps}/${result.totalSteps}단계`,
    result === undefined ? scenario.modules?.join(', ') : [result.method, result.path].filter(Boolean).join(' '),
    result === undefined ? undefined : formatDuration(result.durationMs),
  ].filter(Boolean).join(' · ');
}

function formatSuiteFailure(
  scenario: UiSuiteRunResult['scenarios'][number] | undefined,
): string | undefined {
  if (scenario?.failedStep === undefined) return scenario?.error;
  return [
    `실패 단계 ${scenario.failedStep.id}`,
    [scenario.failedStep.method, scenario.failedStep.path].filter(Boolean).join(' '),
    scenario.failedStep.responseStatus === undefined ? undefined : `HTTP ${scenario.failedStep.responseStatus}`,
    scenario.failedStep.condition,
    scenario.failedStep.error,
  ].filter(Boolean).join(' · ');
}

function formatDuration(value: number): string {
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}
