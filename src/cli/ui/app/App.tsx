import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Toolbar } from '@astryxdesign/core/Toolbar';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UiScenarioDetail, UiScenarioList } from '../scenarios.js';
import type { UiServerCheckResult } from '../server-checks.js';
import type { UiSuiteList } from '../suites.js';
import {
  ScenarioExplorer,
  type ExplorerMode,
} from './ScenarioExplorer';
import { ScenarioFlow } from './ScenarioFlow';
import { UiShell, type MobileView } from './UiShell';
import { resolveActiveModule } from './active-module';
import {
  checkUiServers,
  loadUiScenario,
  loadUiScenarios,
  loadUiSuites,
} from './api';

type SuiteItem = UiSuiteList['suites'][number];

export function App() {
  const [mode, setMode] = useState<ExplorerMode>('scenario');
  const [mobileView, setMobileView] = useState<MobileView>('explorer');
  const [scenarios, setScenarios] = useState<UiScenarioList>();
  const [suites, setSuites] = useState<UiSuiteList>();
  const [serverChecks, setServerChecks] = useState<UiServerCheckResult>();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>();
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>();
  const [scenarioDetail, setScenarioDetail] = useState<UiScenarioDetail>();
  const [scenarioDetailLoading, setScenarioDetailLoading] = useState(false);
  const [scenarioDetailError, setScenarioDetailError] = useState<string>();
  const [scenarioLoading, setScenarioLoading] = useState(true);
  const [suiteLoading, setSuiteLoading] = useState(true);
  const [scenarioError, setScenarioError] = useState<string>();
  const [suiteError, setSuiteError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const loadController = useRef<AbortController | undefined>(undefined);
  const isCompactHeader = useMediaQuery('(max-width: 768px)');

  const load = useCallback(async (signal?: AbortSignal, serverFirst = false) => {
    const fetchScenarios = async () => {
      setScenarioLoading(true);
      setScenarioError(undefined);
      try {
        const next = await loadUiScenarios(signal);
        if (signal?.aborted) return;
        setScenarios(next);
        setSelectedScenarioId((current) => pickSelection(next.scenarios, current));
      } catch (error) {
        if (!signal?.aborted) setScenarioError(toErrorMessage(error));
      } finally {
        if (!signal?.aborted) setScenarioLoading(false);
      }
    };
    const fetchSuites = async () => {
      setSuiteLoading(true);
      setSuiteError(undefined);
      try {
        const next = await loadUiSuites(signal);
        if (signal?.aborted) return;
        setSuites(next);
        setSelectedSuiteId((current) => pickSelection(next.suites, current));
      } catch (error) {
        if (!signal?.aborted) setSuiteError(toErrorMessage(error));
      } finally {
        if (!signal?.aborted) setSuiteLoading(false);
      }
    };
    const fetchServers = async () => {
      setServerError(undefined);
      try {
        const next = await checkUiServers(signal);
        if (!signal?.aborted) setServerChecks(next);
      } catch (error) {
        if (!signal?.aborted) setServerError(toErrorMessage(error));
      }
    };

    if (serverFirst) {
      await fetchServers();
      await Promise.all([fetchScenarios(), fetchSuites()]);
      return;
    }

    await Promise.all([fetchScenarios(), fetchSuites(), fetchServers()]);
  }, []);

  const reload = useCallback(async (serverFirst = false) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      await load(controller.signal, serverFirst);
    } finally {
      if (loadController.current === controller) loadController.current = undefined;
    }
  }, [load]);

  useEffect(() => {
    void reload();
    return () => loadController.current?.abort();
  }, [reload]);

  useEffect(() => {
    if (mode !== 'scenario' || selectedScenarioId === undefined) {
      setScenarioDetail(undefined);
      setScenarioDetailError(undefined);
      setScenarioDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setScenarioDetail(undefined);
    setScenarioDetailError(undefined);
    setScenarioDetailLoading(true);
    void loadUiScenario(selectedScenarioId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setScenarioDetail(detail);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setScenarioDetailError(toErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setScenarioDetailLoading(false);
      });

    return () => controller.abort();
  }, [mode, scenarios, selectedScenarioId]);

  const selectedId = mode === 'scenario' ? selectedScenarioId : selectedSuiteId;
  const selectedScenario = useMemo(
    () => scenarios?.scenarios.find((item) => item.id === selectedScenarioId),
    [scenarios, selectedScenarioId],
  );
  const selectedSuite = useMemo(
    () => suites?.suites.find((item) => item.id === selectedSuiteId),
    [selectedSuiteId, suites],
  );
  const configPath = serverChecks?.configPath ?? scenarios?.configPath;
  const activeModule = resolveActiveModule(serverChecks, scenarios?.defaultModule);
  const defaultTarget = serverChecks?.modules.find((item) => item.name === activeModule)
    ?? serverChecks?.modules[0];
  const headerStatus = getServerStatus(serverChecks, serverError);
  const configSummary = [
    configPath,
    defaultTarget && `${defaultTarget.name} · ${defaultTarget.baseUrl ?? 'URL 미설정'}`,
  ].filter(Boolean).join(' · ');

  const handleSelect = (id: string) => {
    if (mode === 'scenario') setSelectedScenarioId(id);
    else setSelectedSuiteId(id);
  };

  return (
    <UiShell
      explorer={(
        <ScenarioExplorer
          error={mode === 'scenario' ? scenarioError : suiteError}
          loading={mode === 'scenario' ? scenarioLoading : suiteLoading}
          mode={mode}
          onModeChange={setMode}
          onSelect={handleSelect}
          scenarios={scenarios}
          selectedId={selectedId}
          suites={suites}
        />
      )}
      flow={(
        mode === 'scenario' ? (
          <ScenarioFlow
            defaultModule={activeModule}
            detail={scenarioDetail?.id === selectedScenarioId ? scenarioDetail : undefined}
            error={scenarioDetailError}
            item={selectedScenario}
            loading={scenarioDetailLoading}
            modules={serverChecks?.modules ?? []}
          />
        ) : <SuitePreview item={selectedSuite} />
      )}
      header={(
        <TopNav
          endContent={(
            <HStack gap={2} vAlign="center">
              <StatusDot
                label={headerStatus.label}
                tooltip={headerStatus.label}
                variant={headerStatus.variant}
              />
              <Text type="supporting">{headerStatus.text}</Text>
              <IconButton
                clickAction={() => reload(true)}
                icon={<Text aria-hidden="true" type="label">↻</Text>}
                label="새로고침"
                size="sm"
                tooltip="config와 목록 새로고침"
                variant="ghost"
              />
            </HStack>
          )}
          heading={<TopNavHeading heading="openapi-k6" />}
          label="openapi-k6 도구 모음"
          startContent={!isCompactHeader && configSummary !== '' ? (
            <Text hasTruncateTooltip maxLines={1} type="supporting">
              {configSummary}
            </Text>
          ) : undefined}
        />
      )}
      mobileView={mobileView}
      onMobileViewChange={setMobileView}
      run={<RunPlaceholder />}
    />
  );
}

function SuitePreview({ item }: { item?: SuiteItem }) {
  if (item === undefined) {
    return (
      <VStack padding={6}>
        <EmptyState
          description="왼쪽 탐색에서 확인할 항목을 선택하세요."
          isCompact
          title="선택된 항목 없음"
        />
      </VStack>
    );
  }

  return (
    <VStack gap={5} padding={6}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Text color="secondary" type="label">스위트</Text>
          {item.scenarioCount !== undefined && (
            <Badge label={`${item.scenarioCount}개`} />
          )}
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
      ) : (
        <Text color="secondary" type="supporting">
          실행 대상은 포함된 시나리오별로 결정됩니다.
        </Text>
      )}

      <EmptyState
        description="스위트 구성과 실행은 5단계에서 연결합니다."
        isCompact
        title="스위트 상세 준비 중"
      />
    </VStack>
  );
}

function RunPlaceholder() {
  return (
    <VStack height="100%">
      <Toolbar
        dividers={['bottom']}
        label="실행 패널"
        size="sm"
        startContent={<Text type="label" weight="semibold">실행</Text>}
      />
      <VStack padding={6}>
        <EmptyState
          description="실행과 로그는 4단계에서 연결합니다."
          isCompact
          title="실행 대기"
        />
      </VStack>
    </VStack>
  );
}

function pickSelection<T extends { id: string; error?: string }>(items: T[], current?: string) {
  return items.some((item) => item.id === current && item.error === undefined)
    ? current
    : items.find((item) => item.error === undefined)?.id;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getServerStatus(
  checks: UiServerCheckResult | undefined,
  error: string | undefined,
): { label: string; text: string; variant: StatusDotVariant } {
  if (error !== undefined) return { label: error, text: '대상 확인 실패', variant: 'error' };
  if (checks === undefined) return { label: '대상 서버 확인 중', text: '확인 중', variant: 'neutral' };
  const reachable = checks.modules.filter((item) => item.status === 'reachable').length;
  const failed = checks.modules.some((item) => item.status === 'failed');
  const allReachable = checks.modules.length > 0 && reachable === checks.modules.length;
  return {
    label: `대상 서버 ${reachable}/${checks.modules.length} 연결`,
    text: `${reachable}/${checks.modules.length} 연결`,
    variant: allReachable ? 'success' : failed ? 'warning' : 'neutral',
  };
}
