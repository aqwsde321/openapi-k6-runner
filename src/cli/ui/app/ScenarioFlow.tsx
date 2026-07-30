import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import {
  Collapsible,
  CollapsibleGroup,
} from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Item } from '@astryxdesign/core/Item';
import {
  MetadataList,
  MetadataListItem,
} from '@astryxdesign/core/MetadataList';
import { Section } from '@astryxdesign/core/Section';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';

import type {
  UiScenarioDetail,
  UiScenarioList,
} from '../scenarios.js';
import type { UiRunStatus, UiRunStepResult, UiRunTestResult } from '../run-state.js';
import type { UiServerCheckResult } from '../server-checks.js';
import {
  formatRequestPreview,
  formatResponsePreview,
  formatRunRequest,
  formatRunResponse,
  resolveScenarioTargetNames,
} from './scenario-flow-format';

type ScenarioItem = UiScenarioList['scenarios'][number];
type ScenarioStep = UiScenarioDetail['steps'][number];
type ModuleCheck = UiServerCheckResult['modules'][number];

export interface ScenarioFlowProps {
  defaultModule?: string;
  detail?: UiScenarioDetail;
  error?: string;
  item?: ScenarioItem;
  loading: boolean;
  modules: ModuleCheck[];
  testResult?: UiRunTestResult;
  testStatus?: 'starting' | UiRunStatus;
}

export function ScenarioFlow({
  defaultModule,
  detail,
  error,
  item,
  loading,
  modules,
  testResult,
  testStatus,
}: ScenarioFlowProps) {
  if (item === undefined) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="왼쪽 탐색에서 확인할 시나리오를 선택하세요."
          isCompact
          title="선택된 시나리오 없음"
        />
      </VStack>
    );
  }

  const targetNames = resolveScenarioTargetNames(detail, item.modules, defaultModule);

  return (
    <VStack gap={0}>
      <Section dividers={['bottom']} padding={5}>
        <VStack gap={4}>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <Text color="secondary" type="label">시나리오</Text>
              <Badge label={`${detail?.stepCount ?? item.stepCount ?? 0}단계`} />
            </HStack>
            <Heading level={2} maxLines={2}>{detail?.name ?? item.name}</Heading>
            <Text as="p" color="secondary" type="supporting">
              {detail?.description ?? item.description ?? item.path}
            </Text>
          </VStack>

          <VStack gap={2}>
            <Text type="label" weight="semibold">실행 대상</Text>
            {targetNames.length === 0 ? (
              <Text color="secondary" type="supporting">대상 모듈 정보 없음</Text>
            ) : targetNames.map((name) => (
              <TargetRow
                key={name}
                module={modules.find((candidate) => candidate.name === name)}
                name={name}
              />
            ))}
          </VStack>
        </VStack>
      </Section>

      {item.error !== undefined || error !== undefined ? (
        <Banner
          container="section"
          description={item.error ?? error ?? ''}
          status="error"
          title="시나리오 상세를 불러오지 못했습니다"
        />
      ) : loading || detail === undefined ? (
        <VStack padding={6}>
          <Text color="secondary" type="supporting">시나리오 상세 불러오는 중…</Text>
        </VStack>
      ) : (
        <ScenarioSteps
          defaultModule={defaultModule}
          detail={detail}
          testResult={testResult}
          testStatus={testStatus}
        />
      )}
    </VStack>
  );
}

function ScenarioSteps({
  defaultModule,
  detail,
  testResult,
  testStatus,
}: {
  defaultModule?: string;
  detail: UiScenarioDetail;
  testResult?: UiRunTestResult;
  testStatus?: 'starting' | UiRunStatus;
}) {
  if (detail.steps.length === 0) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="시나리오 YAML에 실행 단계가 없습니다."
          isCompact
          title="실행할 endpoint 없음"
        />
      </VStack>
    );
  }

  const unresolved = detail.steps.some((step) => (
    step.input === undefined && (step.method === undefined || step.path === undefined)
  ));

  return (
    <Section padding={0}>
      <Section dividers={['bottom']} padding={4} paddingBlock={3}>
        <HStack gap={2} hAlign="between" vAlign="center">
          <Heading level={3}>실행 예정 endpoint</Heading>
          <HStack gap={2} vAlign="center">
            {testStatus !== undefined && <RunStatus status={testStatus} />}
            <Badge label={detail.steps.length} />
          </HStack>
        </HStack>
      </Section>
      {unresolved && (
        <Section dividers={['bottom']} padding={4}>
          <Text color="secondary" type="supporting">
            OpenAPI에서 일부 endpoint를 해석하지 못해 YAML 기준 정보만 표시합니다.
          </Text>
        </Section>
      )}
      <CollapsibleGroup key={detail.id} density="compact" hasDividers type="multiple">
        {detail.steps.map((step, index) => (
          <Collapsible
            key={`${index}:${step.id}`}
            trigger={(
              <StepRow
                defaultModule={defaultModule}
                index={index}
                result={testResult?.steps.find((candidate) => candidate.index === index)}
                step={step}
                testFinished={testStatus === 'passed' || testStatus === 'failed'}
              />
            )}
            value={String(index)}
          >
            <StepDetail
              result={testResult?.steps.find((candidate) => candidate.index === index)}
              step={step}
            />
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </Section>
  );
}

function StepRow({
  defaultModule,
  index,
  result,
  step,
  testFinished,
}: {
  defaultModule?: string;
  index: number;
  result?: UiRunStepResult;
  step: ScenarioStep;
  testFinished: boolean;
}) {
  const targetModule = step.input === undefined
    ? step.targetModule ?? step.module ?? defaultModule
    : undefined;

  return (
    <Item
      align="start"
      as="span"
      density="compact"
      description={(
        <HStack as="span" gap={2} vAlign="center" wrap="wrap">
          <Text color="secondary" type="code">
            {formatStepEndpoint(step)}
          </Text>
          {targetModule !== undefined && (
            <Text color="secondary" type="supporting">{targetModule}</Text>
          )}
          <Text color="secondary" type="supporting">{formatStepSource(step)}</Text>
        </HStack>
      )}
      label={step.id}
      marker={(
        <Text hasTabularNumbers type="supporting">{index + 1}</Text>
      )}
      endContent={result !== undefined
        ? <RunStatus status={result.status} />
        : testFinished
          ? <RunStatus status="not-run" />
          : undefined}
    />
  );
}

function StepDetail({ result, step }: { result?: UiRunStepResult; step: ScenarioStep }) {
  const actualRequest = formatRunRequest(result?.url, result?.request);
  const actualResponse = formatRunResponse(result?.response);
  const request = actualRequest ?? formatRequestPreview(step.request);
  const response = actualResponse ?? formatResponsePreview(step.expectedResponse);
  const hasMetadata = step.input !== undefined || result?.input !== undefined ||
    step.condition !== undefined || result?.condition !== undefined ||
    step.extract !== undefined || (result?.extracts.length ?? 0) > 0;

  return (
    <VStack gap={4} paddingBlock={2}>
      {request !== undefined && (
        <CodeBlock
          code={request}
          container="section"
          isWrapped
          language="plaintext"
          size="sm"
          title={actualRequest === undefined ? '요청 · 예정 구조' : '요청 · 실제'}
          width="100%"
        />
      )}
      {response !== undefined && (
        <CodeBlock
          code={response}
          container="section"
          isWrapped
          language="plaintext"
          size="sm"
          title={actualResponse === undefined ? '응답 · 예상 (OpenAPI)' : '응답 · 실제'}
          width="100%"
        />
      )}
      {hasMetadata && (
        <MetadataList label={{ position: 'top' }}>
          {(result?.input ?? step.input) !== undefined && (
            <MetadataListItem label="입력">
              <Text type="supporting">
                {formatInputResult(step, result)}
              </Text>
            </MetadataListItem>
          )}
          {(result?.condition ?? step.condition) !== undefined && (
            <MetadataListItem label="검증">
              <HStack gap={2} vAlign="center" wrap="wrap">
                {result?.condition !== undefined && (
                  <RunStatus status={result.condition.passed ? 'passed' : 'failed'} />
                )}
                <Code>{result?.condition?.expression ?? step.condition}</Code>
              </HStack>
            </MetadataListItem>
          )}
          {(result?.extracts.length ?? 0) > 0 ? (
            <MetadataListItem label="추출">
              <VStack gap={1}>
                {result?.extracts.map((extract) => (
                  <HStack key={extract.name} gap={2} vAlign="center" wrap="wrap">
                    <RunStatus status={extract.passed ? 'passed' : 'failed'} />
                    <Text type="code">{extract.name} · {extract.path}</Text>
                    {extract.error !== undefined && (
                      <Text color="secondary" type="supporting">{extract.error}</Text>
                    )}
                  </HStack>
                ))}
              </VStack>
            </MetadataListItem>
          ) : step.extract !== undefined && (
            <MetadataListItem label="추출">
              <Text type="code">{step.extract.join(', ')}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
      )}
      {result?.error !== undefined && (
        <Banner
          container="section"
          description={result.error}
          status="error"
          title="단계 실행 실패"
        />
      )}
      {step.definition !== undefined && (
        <CodeBlock
          code={step.definition.code}
          container="section"
          isWrapped
          language={step.definition.path.toLowerCase().endsWith('.json') ? 'json' : 'yaml'}
          size="sm"
          title={step.definition.path}
          width="100%"
        />
      )}
      {request === undefined && response === undefined && !hasMetadata && step.definition === undefined && (
        <Text color="secondary" type="supporting">표시할 상세 정보 없음</Text>
      )}
    </VStack>
  );
}

function RunStatus({ status }: { status: 'starting' | UiRunStatus | 'not-run' }) {
  const value = status === 'starting'
    ? { label: '시작 중', variant: 'accent' as const }
    : status === 'running'
      ? { label: '실행 중', variant: 'accent' as const }
      : status === 'passed'
        ? { label: '성공', variant: 'success' as const }
        : status === 'failed'
          ? { label: '실패', variant: 'error' as const }
          : { label: '미실행', variant: 'neutral' as const };

  return (
    <HStack as="span" gap={1} vAlign="center">
      <StatusDot
        isPulsing={status === 'starting' || status === 'running'}
        label={value.label}
        variant={value.variant}
      />
      <Text type="supporting">{value.label}</Text>
    </HStack>
  );
}

function formatInputResult(step: ScenarioStep, result: UiRunStepResult | undefined): string {
  if (result?.input !== undefined) {
    const source = result.input.source === 'prompt'
      ? '화면 입력'
      : result.input.source === 'vars'
        ? '변수'
        : '미입력';
    return `${result.input.label ?? result.input.name} · ${source}${result.input.sensitive ? ' · 민감값' : ''}`;
  }

  if (step.input === undefined) return '';
  return `${step.input.label ?? step.input.name} · ${step.input.required ? '필수' : '선택'}${step.input.sensitive ? ' · 민감값' : ''}`;
}

function TargetRow({ module, name }: { module?: ModuleCheck; name: string }) {
  const status = module?.status ?? 'unknown';
  const label = status === 'reachable' ? '연결됨' : status === 'failed' ? '실패' : '미확인';

  return (
    <HStack gap={2} vAlign="center">
      <StatusDot
        label={`${name} ${label}`}
        tooltip={`${name} ${label}`}
        variant={status === 'reachable' ? 'success' : status === 'failed' ? 'error' : 'neutral'}
      />
      <Text type="label">{name}</Text>
      <Text color="secondary" hasTruncateTooltip maxLines={1} type="code">
        {module?.baseUrl ?? 'URL 미설정'}
      </Text>
      <Text color="secondary" type="supporting">{label}</Text>
    </HStack>
  );
}

function formatStepEndpoint(step: ScenarioStep): string {
  if (step.input !== undefined) return `입력 ${step.input.name}`;
  if (step.method !== undefined && step.path !== undefined) return `${step.method} ${step.path}`;
  if (step.operationId !== undefined) return `operationId ${step.operationId}`;
  return 'endpoint 미해석';
}

function formatStepSource(step: ScenarioStep): string {
  if (step.source.kind === 'direct') return '직접 정의';
  return `${step.source.kind} · ${step.source.reference ?? '-'}`;
}
