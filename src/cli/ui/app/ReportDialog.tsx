import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Item } from '@astryxdesign/core/Item';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { Selector } from '@astryxdesign/core/Selector';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { StatusDot, type StatusDotVariant } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { UiReportList } from '../reports.js';
import { loadUiReport, loadUiReports } from './api';
import {
  collectReportFailures,
  formatReportDate,
  formatReportDuration,
  formatReportFailuresForCopy,
  formatReportListLabel,
  formatReportResult,
  getReportScenarios,
  normalizeResult,
  type UiReportDetail,
  type UiReportScenario,
} from './report-view';

export interface ReportController {
  count: number;
  detail?: UiReportDetail;
  detailError?: string;
  isDetailLoading: boolean;
  isListLoading: boolean;
  isOpen: boolean;
  list?: UiReportList;
  listError?: string;
  selectedId?: string;
  open(reportId?: string): void;
  refresh(preferredId?: string): Promise<void>;
  select(reportId: string): void;
  setIsOpen(value: boolean): void;
}

export function useReportController(): ReportController {
  const [isOpen, setIsOpen] = useState(false);
  const [list, setList] = useState<UiReportList>();
  const [listError, setListError] = useState<string>();
  const [isListLoading, setIsListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<UiReportDetail>();
  const [detailError, setDetailError] = useState<string>();
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const listRequest = useRef(0);

  const refresh = useCallback(async (preferredId?: string) => {
    const request = ++listRequest.current;
    setIsListLoading(true);
    setListError(undefined);
    try {
      const next = await loadUiReports();
      if (request !== listRequest.current) return;
      setList(next);
      setSelectedId((current) => pickReportId(next, preferredId ?? current));
      setDetailRevision((current) => current + 1);
    } catch (error) {
      if (request === listRequest.current) setListError(toErrorMessage(error));
    } finally {
      if (request === listRequest.current) setIsListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isOpen || selectedId === undefined) {
      setDetail(undefined);
      setDetailError(undefined);
      setIsDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetail(undefined);
    setDetailError(undefined);
    setIsDetailLoading(true);
    void loadUiReport(selectedId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setDetail(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(toErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });

    return () => controller.abort();
  }, [detailRevision, isOpen, selectedId]);

  const open = useCallback((reportId?: string) => {
    if (reportId !== undefined) setSelectedId(reportId);
    setIsOpen(true);
    void refresh(reportId);
  }, [refresh]);

  return {
    count: list?.reports.length ?? 0,
    detail,
    detailError,
    isDetailLoading,
    isListLoading,
    isOpen,
    list,
    listError,
    selectedId,
    open,
    refresh,
    select: setSelectedId,
    setIsOpen,
  };
}

export function ReportDialog({ controller }: { controller: ReportController }) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string>();
  const selected = controller.list?.reports.find((report) => report.id === controller.selectedId);
  const scenarios = getReportScenarios(controller.detail ?? {}, failuresOnly);
  const failures = collectReportFailures(controller.detail ?? {});
  const title = controller.detail?.suite?.name ?? controller.detail?.suite?.key ?? '리포트';

  useEffect(() => {
    setFailuresOnly(false);
    setCopyMessage(undefined);
  }, [controller.isOpen, controller.selectedId]);

  const copyFailures = async () => {
    try {
      await navigator.clipboard.writeText(formatReportFailuresForCopy(failures));
      setCopyMessage('실패 원인을 복사했습니다.');
    } catch (error) {
      setCopyMessage(`복사 실패: ${toErrorMessage(error)}`);
    }
  };

  return (
    <Dialog
      isOpen={controller.isOpen}
      maxHeight="90vh"
      onOpenChange={controller.setIsOpen}
      purpose="info"
      width={960}
    >
      <Layout
        header={(
          <DialogHeader
            endContent={<Badge label={String(controller.count)} />}
            onOpenChange={controller.setIsOpen}
            subtitle={controller.list?.reportDir ?? '스위트 실행 결과'}
            title="리포트"
          />
        )}
        content={(
          <LayoutContent isScrollable padding={0}>
            <VStack gap={4} padding={4}>
              {controller.listError !== undefined && (
                <Banner
                  container="section"
                  description={controller.listError}
                  status="error"
                  title="리포트 목록을 불러오지 못했습니다"
                />
              )}

              <HStack gap={2} vAlign="end" wrap="wrap">
                <StackItem size="fill">
                  <Selector
                    hasSearch={(controller.list?.reports.length ?? 0) > 8}
                    isDisabled={controller.isListLoading || controller.count === 0}
                    label="리포트 선택"
                    onChange={controller.select}
                    options={(controller.list?.reports ?? []).map((report) => ({
                      label: formatReportListLabel(report),
                      value: report.id,
                    }))}
                    placeholder={controller.isListLoading ? '불러오는 중…' : '리포트 없음'}
                    searchPlaceholder="리포트 검색"
                    size="sm"
                    value={controller.selectedId}
                  />
                </StackItem>
                <IconButton
                  clickAction={() => controller.refresh(controller.selectedId)}
                  icon={<Text aria-hidden="true" type="label">↻</Text>}
                  label="리포트 새로고침"
                  size="sm"
                  tooltip="리포트 목록 새로고침"
                  variant="ghost"
                />
              </HStack>

              {controller.count === 0 && !controller.isListLoading ? (
                <EmptyState
                  description="스위트를 실행하면 JSON 리포트가 생성됩니다."
                  isCompact
                  title="생성된 리포트 없음"
                />
              ) : selected?.error !== undefined ? (
                <Banner
                  container="section"
                  description={selected.error}
                  status="error"
                  title="리포트 JSON 오류"
                />
              ) : controller.detailError !== undefined ? (
                <Banner
                  container="section"
                  description={controller.detailError}
                  status="error"
                  title="리포트를 열지 못했습니다"
                />
              ) : controller.detail === undefined ? (
                <Text color="secondary" type="supporting">
                  {controller.isDetailLoading ? '리포트 불러오는 중…' : '리포트를 선택하세요.'}
                </Text>
              ) : (
                <VStack gap={4}>
                  <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center">
                        <StatusDot
                          label={formatReportResult(controller.detail.result)}
                          variant={reportStatusVariant(controller.detail.result)}
                        />
                        <Text type="supporting">{formatReportResult(controller.detail.result)}</Text>
                        <Heading level={2}>{title}</Heading>
                      </HStack>
                      <Text color="secondary" type="supporting">
                        {formatReportDate(controller.detail.generatedAt) || controller.selectedId}
                      </Text>
                    </VStack>
                    <HStack gap={3} vAlign="center" wrap="wrap">
                      <Link
                        href={`/api/report/html?report=${encodeURIComponent(controller.selectedId ?? '')}`}
                        isExternalLink
                        isStandalone
                      >
                        HTML 새 탭
                      </Link>
                      <Link
                        href={`/api/report/download?format=html&report=${encodeURIComponent(controller.selectedId ?? '')}`}
                        isStandalone
                      >
                        HTML 다운로드
                      </Link>
                      <Link
                        href={`/api/report/download?format=json&report=${encodeURIComponent(controller.selectedId ?? '')}`}
                        isStandalone
                      >
                        JSON 다운로드
                      </Link>
                      <IconButton
                        clickAction={copyFailures}
                        icon={<Icon icon="copy" />}
                        isDisabled={failures.length === 0}
                        label="실패 원인 복사"
                        size="sm"
                        tooltip="실패 원인 복사"
                        variant="ghost"
                      />
                    </HStack>
                  </HStack>

                  <HStack gap={4} wrap="wrap">
                    <Text color="secondary" type="supporting">
                      시나리오 {formatCount(controller.detail.summary?.scenarios?.passed)}/
                      {formatCount(controller.detail.summary?.scenarios?.total)}
                    </Text>
                    <Text color="secondary" type="supporting">
                      단계 {formatCount(controller.detail.summary?.steps?.passed)}/
                      {formatCount(controller.detail.summary?.steps?.total)}
                    </Text>
                    <Text color="secondary" type="supporting">
                      {formatReportDuration(controller.detail.summary?.durationMs)}
                    </Text>
                  </HStack>

                  {copyMessage !== undefined && (
                    <Text color="secondary" role="status" type="supporting">{copyMessage}</Text>
                  )}

                  <HStack hAlign="between" vAlign="center">
                    <Heading level={3}>테스트한 시나리오</Heading>
                    <CheckboxInput
                      label="실패만"
                      onChange={setFailuresOnly}
                      size="sm"
                      value={failuresOnly}
                    />
                  </HStack>

                  {scenarios.length === 0 ? (
                    <EmptyState
                      description={failuresOnly ? '실패한 시나리오가 없습니다.' : '시나리오 결과가 없습니다.'}
                      isCompact
                      title="표시할 결과 없음"
                    />
                  ) : (
                    <VStack gap={0}>
                      {scenarios.map((scenario, index) => (
                        <ReportScenarioRow
                          key={`${scenario.key ?? scenario.name ?? 'scenario'}:${index}`}
                          scenario={scenario}
                          showDivider={index > 0}
                        />
                      ))}
                    </VStack>
                  )}
                </VStack>
              )}
            </VStack>
          </LayoutContent>
        )}
      />
    </Dialog>
  );
}

function ReportScenarioRow({
  scenario,
  showDivider,
}: {
  scenario: UiReportScenario;
  showDivider: boolean;
}) {
  const failed = collectReportFailures({ scenarios: [scenario] })[0];
  const steps = scenario.steps ?? [];
  const passedSteps = steps.filter((step) => normalizeResult(step.result) === 'passed').length;
  const status = normalizeResult(scenario.result);
  const description = [
    steps.length === 0 ? undefined : `${passedSteps}/${steps.length}단계`,
    formatReportDuration(scenario.durationMs),
    failed === undefined
      ? undefined
      : [
          failed.step,
          failed.request,
          `actual ${failed.actual}`,
          `expected ${failed.expected}`,
          failed.error,
        ]
        .filter(Boolean)
        .join(' · '),
  ].filter(Boolean).join(' · ');

  return (
    <>
      {showDivider && <Divider />}
      <Item
        align="start"
        density="compact"
        description={description}
        endContent={<Text color="secondary" type="supporting">{formatReportResult(scenario.result)}</Text>}
        label={scenario.name ?? scenario.key ?? 'scenario'}
        startContent={(
          <StatusDot
            label={formatReportResult(scenario.result)}
            variant={status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'neutral'}
          />
        )}
      />
    </>
  );
}

function reportStatusVariant(value: string | undefined): StatusDotVariant {
  const status = normalizeResult(value);
  return status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'neutral';
}

function pickReportId(list: UiReportList, preferred?: string): string | undefined {
  if (list.reports.some((report) => report.id === preferred)) return preferred;
  return list.reports.find((report) => report.error === undefined)?.id ?? list.reports[0]?.id;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '-' : String(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
