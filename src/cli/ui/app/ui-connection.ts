import { useCallback, useEffect, useRef, useState } from 'react';

const UI_CONNECTION_CHECK_INTERVAL_MS = 5_000;

export type UiConnectionStatus = 'connected' | 'disconnected';

export interface UiConnection {
  status: UiConnectionStatus;
  isConnected: boolean;
  error?: string;
  markDisconnected(error?: unknown): void;
}

export interface UseUiConnectionOptions {
  probe(signal: AbortSignal): Promise<void>;
  onRecovered?(): void;
}

interface UiConnectionPollingOptions extends UseUiConnectionOptions {
  isDisconnected(): boolean;
  onDisconnected(error: unknown): void;
}

export function useUiConnection({ probe, onRecovered }: UseUiConnectionOptions): UiConnection {
  const [connection, setConnection] = useState<Omit<UiConnection, 'isConnected' | 'markDisconnected'>>({
    status: 'connected',
  });
  const disconnected = useRef(false);
  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  const markDisconnected = useCallback((error?: unknown) => {
    const message = error === undefined ? undefined : toErrorMessage(error);
    disconnected.current = true;
    setConnection((current) => (
      current.status === 'disconnected' && current.error === message
        ? current
        : { status: 'disconnected', ...(message === undefined ? {} : { error: message }) }
    ));
  }, []);

  useEffect(() => startUiConnectionPolling({
    probe,
    isDisconnected: () => disconnected.current,
    onDisconnected: markDisconnected,
    onRecovered: () => {
      disconnected.current = false;
      setConnection({ status: 'connected' });
      onRecoveredRef.current?.();
    },
  }), [markDisconnected, probe]);

  return {
    ...connection,
    isConnected: connection.status === 'connected',
    markDisconnected,
  };
}

export function startUiConnectionPolling({
  probe,
  isDisconnected,
  onDisconnected,
  onRecovered,
}: UiConnectionPollingOptions): () => void {
  let active = true;
  let running = false;
  let controller: AbortController | undefined;

  const check = async () => {
    if (!active || running) return;
    running = true;
    controller = new AbortController();

    try {
      await probe(controller.signal);
    } catch (error) {
      if (active && !controller.signal.aborted && !isDisconnected()) onDisconnected(error);
      return;
    } finally {
      running = false;
      controller = undefined;
    }

    if (active && isDisconnected()) onRecovered?.();
  };
  const interval = setInterval(() => void check(), UI_CONNECTION_CHECK_INTERVAL_MS);

  return () => {
    active = false;
    clearInterval(interval);
    controller?.abort();
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
