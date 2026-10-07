import { useCallback, useEffect, useState } from "react";
import { searchTasks } from "./api";
import type { Task, StatusFilter } from "./types";

/**
 * T1：查询请求的生命周期与竞态控制。
 *
 * 每次 q/status/attempt 变化都会开启一个新请求，并同时：
 *   1. 用 AbortController 取消上一个仍在进行的请求；
 *   2. 用 active 标记让上一个请求的回调彻底失效。
 *
 * 因此只有“当前有效查询”能提交 result / error / loading，
 * 旧请求无论成功、失败还是先结束，都不会覆盖新查询。
 */
export function useTaskSearch(q: string, status: StatusFilter) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 同一条件再次提交（例如失败后点“查询”重试）时，用它强制重新发起请求。
  const [attempt, setAttempt] = useState(0);
  // 当前 tasks 对应的查询身份；只有它与当前 q/status 一致时，tasks 才是“当前查询的结果”。
  const [resolved, setResolved] = useState<{
    q: string;
    status: StatusFilter;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setError("");

    searchTasks(q, status, controller.signal)
      .then((result) => {
        if (!active) return;
        setTasks(result);
        setResolved({ q, status });
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      // 依赖变化或组件卸载：本次请求立即失效，不得再提交任何状态。
      active = false;
      controller.abort();
    };
  }, [q, status, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { tasks, loading, error, retry, resolved };
}