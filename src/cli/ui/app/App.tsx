import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { UiScenarioDetail, UiScenarioList } from '../scenarios.js';
import type { UiServerCheckResult } from '../server-checks.js';
import type { UiSuiteDetail, UiSuiteList } from '../suites.js';
import { ReportDialog, useReportController } from './ReportDialog';
import {
  ScenarioExplorer,
  type ExplorerMode,
} from './ScenarioExplorer';
import { ScenarioFlow } from './ScenarioFlow';
import {
  ScenarioRunPanel,
  useScenarioRunController,
} from './ScenarioRunPanel';
import { SuitePreview } from './SuitePreview';
import { UiShell, type MobileView } from './UiShell';
import { resolveActiveModule } from './active-module';
import {
  checkUiServers,
  loadUiScenario,
  loadUiScenarios,
  loadUiSuite,
  loadUiSuites,
  probeUiServer,
  UiConnectionError,
} from './api';
import { reportIdFromPath } from './report-view';
import {
  selectLatestSuiteReportRun,
  selectLatestUiRun,
  selectScenarioRun,
} from './scenario-runs';
import { useUiConnection } from './ui-connection';

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
  const [suiteDetail, setSuiteDetail] = useState<UiSuiteDetail>();
  const [suiteDetailLoading, setSuiteDetailLoading] = useState(false);
  const [suiteDetailError, setSuiteDetailError] = useState<string>();
  const [scenarioLoading, setScenarioLoading] = useState(true);
  const [suiteLoading, setSuiteLoading] = useState(true);
  const [scenarioError, setScenarioError] = useState<string>();
  const [suiteError, setSuiteError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const loadController = useRef<AbortController | undefined>(undefined);
  const reloadRef = useRef<() => Promise<void>>(async () => undefined);
  const isCompactHeader = useMediaQuery('(max-width: 768px)');
  const runController = useScenarioRunController();
  const reportController = useReportController();
  const probeConnection = useCallback(async (signal: AbortSignal) => {
    try {
      await probeUiServer(signal);
    } catch (error) {
      if (error instanceof UiConnectionError) throw error;
    }
  }, []);
  const uiConnection = useUiConnection({
    probe: probeConnection,
    onRecovered: () => {
      void reloadRef.current();
      void reportController.refresh();
    },
  });
  const markDisconnected = uiConnection.markDisconnected;

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
        if (!signal?.aborted) {
          setScenarioError(toErrorMessage(error));
          if (error instanceof UiConnectionError) markDisconnected(error);
        }
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
        if (!signal?.aborted) {
          setSuiteError(toErrorMessage(error));
          if (error instanceof UiConnectionError) markDisconnected(error);
        }
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
        if (!signal?.aborted) {
          setServerError(toErrorMessage(error));
          if (error instanceof UiConnectionError) markDisconnected(error);
        }
      }
    };

    if (serverFirst) {
      await fetchServers();
      await Promise.all([fetchScenarios(), fetchSuites()]);
      return;
    }

    await Promise.all([fetchScenarios(), fetchSuites(), fetchServers()]);
  }, [markDisconnected]);

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
  reloadRef.current = () => reload(true);

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
        if (!controller.signal.aborted) {
          setScenarioDetailError(toErrorMessage(error));
          if (error instanceof UiConnectionError) markDisconnected(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setScenarioDetailLoading(false);
      });

    return () => controller.abort();
  }, [markDisconnected, mode, scenarios, selectedScenarioId]);

  useEffect(() => {
    if (mode !== 'suite' || selectedSuiteId === undefined) {
      setSuiteDetail(undefined);
      setSuiteDetailError(undefined);
      setSuiteDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setSuiteDetail(undefined);
    setSuiteDetailError(undefined);
    setSuiteDetailLoading(true);
    void loadUiSuite(selectedSuiteId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setSuiteDetail(detail);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSuiteDetailError(toErrorMessage(error));
          if (error instanceof UiConnectionError) markDisconnected(error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSuiteDetailLoading(false);
      });

    return () => controller.abort();
  }, [markDisconnected, mode, selectedSuiteId, suites]);

  const selectedId = mode === 'scenario' ? selectedScenarioId : selectedSuiteId;
  const selectedScenario = useMemo(
    () => scenarios?.scenarios.find((item) => item.id === selectedScenarioId),
    [scenarios, selectedScenarioId],
  );
  const selectedSuite = useMemo(
    () => suites?.suites.find((item) => item.id === selectedSuiteId),
    [selectedSuiteId, suites],
  );
  const selectedScenarioTestRun = selectedScenarioId === undefined
    ? undefined
    : selectScenarioRun(runController.runs, selectedScenarioId, 'test');
  const selectedSuiteLatestRun = selectedSuiteId === undefined
    ? undefined
    : selectLatestUiRun(runController.runs, { kind: 'suite', id: selectedSuiteId });
  const suiteReportId = reportIdFromPath(
    selectLatestSuiteReportRun(runController.runs)?.suiteResult?.reportPath,
  );
  const configPath = serverChecks?.configPath ?? scenarios?.configPath;
  const activeModule = resolveActiveModule(serverChecks, scenarios?.defaultModule);
  const defaultTarget = serverChecks?.modules.find((item) => item.name === activeModule)
    ?? serverChecks?.modules[0];
  const headerStatus = getServerStatus(serverChecks, serverError, uiConnection);
  const configSummary = [
    configPath,
    defaultTarget && `${defaultTarget.name} · ${defaultTarget.baseUrl ?? 'URL 미설정'}`,
  ].filter(Boolean).join(' · ');

  const handleSelect = (id: string) => {
    if (mode === 'scenario') setSelectedScenarioId(id);
    else setSelectedSuiteId(id);
  };

  useEffect(() => {
    if (suiteReportId !== undefined) void reportController.refresh(suiteReportId);
  }, [reportController.refresh, suiteReportId]);

  return (
    <>
      <UiShell
        explorer={(
          <ScenarioExplorer
            error={mode === 'scenario' ? scenarioError : suiteError}
            loading={mode === 'scenario' ? scenarioLoading : suiteLoading}
            mode={mode}
            onModeChange={setMode}
            onSelect={handleSelect}
            runs={runController.runs}
            scenarios={scenarios}
            selectedId={selectedId}
            suites={suites}
          />
        )}
        flow={(
          mode === 'scenario' ? (
            <ScenarioFlow
              key={selectedScenarioId}
              defaultModule={activeModule}
              detail={scenarioDetail?.id === selectedScenarioId ? scenarioDetail : undefined}
              error={scenarioDetailError}
              item={selectedScenario}
              loading={scenarioDetailLoading}
              modules={serverChecks?.modules ?? []}
              onScenarioSaved={reload}
              testResult={selectedScenarioTestRun?.testResult}
              testStatus={selectedScenarioTestRun?.status}
            />
          ) : (
            <SuitePreview
              detail={suiteDetail?.id === selectedSuiteId ? suiteDetail : undefined}
              error={suiteDetailError}
              item={selectedSuite}
              loading={suiteDetailLoading}
              onOpenReport={reportController.open}
              result={selectedSuiteLatestRun?.suiteResult}
              status={selectedSuiteLatestRun?.status}
            />
          )
        )}
        header={(
          <TopNav
            endContent={(
              <HStack gap={2} vAlign="center">
                <Button
                  clickAction={() => reportController.open()}
                  endContent={<Badge label={String(reportController.count)} />}
                  label="리포트"
                  size="sm"
                  variant="ghost"
                />
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
        run={(
          <ScenarioRunPanel
            {...runController}
            isConnected={uiConnection.isConnected}
            isReady={uiConnection.isConnected && (mode === 'scenario'
              ? scenarioDetail?.id === selectedScenarioId &&
                selectedScenario?.error === undefined && scenarioDetailError === undefined
              : suiteDetail?.id === selectedSuiteId &&
                selectedSuite?.error === undefined && suiteDetailError === undefined)}
            onOpenReport={reportController.open}
            targetId={selectedId}
            targetKind={mode}
            targetName={mode === 'scenario' ? selectedScenario?.name : selectedSuite?.name}
          />
        )}
      />
      <ReportDialog controller={reportController} />
    </>
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
  connection: { isConnected: boolean; error?: string },
): { label: string; text: string; variant: StatusDotVariant } {
  if (!connection.isConnected) {
    return {
      label: connection.error ?? 'UI 서버 연결 끊김',
      text: 'UI 재연결 중',
      variant: 'error',
    };
  }
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
