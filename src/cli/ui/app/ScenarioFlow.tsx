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
import type { UiServerCheckResult } from '../server-checks.js';
import {
  formatRequestPreview,
  formatResponsePreview,
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
}

export function ScenarioFlow({
  defaultModule,
  detail,
  error,
  item,
  loading,
  modules,
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
        <ScenarioSteps defaultModule={defaultModule} detail={detail} />
      )}
    </VStack>
  );
}

function ScenarioSteps({
  defaultModule,
  detail,
}: {
  defaultModule?: string;
  detail: UiScenarioDetail;
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
          <Badge label={detail.steps.length} />
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
                step={step}
              />
            )}
            value={String(index)}
          >
            <StepDetail step={step} />
          </Collapsible>
        ))}
      </CollapsibleGroup>
    </Section>
  );
}

function StepRow({
  defaultModule,
  index,
  step,
}: {
  defaultModule?: string;
  index: number;
  step: ScenarioStep;
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
    />
  );
}

function StepDetail({ step }: { step: ScenarioStep }) {
  const request = formatRequestPreview(step.request);
  const response = formatResponsePreview(step.expectedResponse);
  const hasMetadata = step.input !== undefined || step.condition !== undefined || step.extract !== undefined;

  return (
    <VStack gap={4} paddingBlock={2}>
      {request !== undefined && (
        <CodeBlock
          code={request}
          container="section"
          isWrapped
          language="plaintext"
          size="sm"
          title="요청 · 예정 구조"
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
          title="응답 · 예상 (OpenAPI)"
          width="100%"
        />
      )}
      {hasMetadata && (
        <MetadataList label={{ position: 'top' }}>
          {step.input !== undefined && (
            <MetadataListItem label="입력">
              <Text type="supporting">
                {step.input.label ?? step.input.name} · {step.input.required ? '필수' : '선택'}
                {step.input.sensitive ? ' · 민감값' : ''}
              </Text>
            </MetadataListItem>
          )}
          {step.condition !== undefined && (
            <MetadataListItem label="검증">
              <Code>{step.condition}</Code>
            </MetadataListItem>
          )}
          {step.extract !== undefined && (
            <MetadataListItem label="추출">
              <Text type="code">{step.extract.join(', ')}</Text>
            </MetadataListItem>
          )}
        </MetadataList>
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
