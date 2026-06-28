import { useState, useEffect } from "react";

interface UseSimulatedProgressOptions {
  active: boolean;
  messages: string[];
  messageIntervalMs?: number;
  stepPercent?: number;
  stepIntervalMs?: number;
  capPercent?: number;
}

interface SimulatedProgress {
  message: string;
  percent: number;
}

export function useSimulatedProgress({
  active,
  messages,
  messageIntervalMs = 4000,
  stepPercent = 1.2,
  stepIntervalMs = 350,
  capPercent = 88,
}: UseSimulatedProgressOptions): SimulatedProgress {
  const [msgIdx, setMsgIdx] = useState(0);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!active) {
      setMsgIdx(0);
      setPercent(0);
      return;
    }
    const lastIdx = Math.max(0, messages.length - 1);
    const msgTimer = setInterval(() => {
      setMsgIdx((prev) => Math.min(prev + 1, lastIdx));
    }, messageIntervalMs);
    const pctTimer = setInterval(() => {
      setPercent((prev) => (prev < capPercent ? prev + stepPercent : prev));
    }, stepIntervalMs);
    return () => {
      clearInterval(msgTimer);
      clearInterval(pctTimer);
    };
  }, [
    active,
    messages.length,
    messageIntervalMs,
    stepPercent,
    stepIntervalMs,
    capPercent,
  ]);

  return {
    message: messages[msgIdx] ?? "",
    percent,
  };
}
