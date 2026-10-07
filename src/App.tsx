import { useEffect, useState } from "react";
import type { StatusFilter } from "./types";
import { useTaskSearch } from "./useTaskSearch";
import { pageOf, readQuery, writeQuery } from "./query";

export default function App() {
  // T2：首次进入 / 刷新时从 URL 恢复已提交的搜索词、筛选与页码。
  const [initial] = useState(() => readQuery(window.location.search));
  const [draft, setDraft] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [status, setStatus] = useState<StatusFilter>(initial.status);
  const [page, setPage] = useState(initial.page);

  const { tasks, loading, error, retry, resolved } = useTaskSearch(q, status);
  const view = pageOf(tasks, page);
  // tasks 是否确实来自“当前筛选条件”的那一次成功查询。
  const isFresh =
    resolved !== null && resolved.q === q && resolved.status === status;

  // T2：只有当前查询成功落地后，才按结果页数钳制越界页码（replace，不新增历史项）。
  // 加载中、出错、或结果还属于上一次查询时都不碰 URL，
  // 避免用加载前的空列表或上一次查询结果提前把恢复的页码改成 1。
  useEffect(() => {
    if (loading || error || !isFresh) return;
    const { current } = pageOf(tasks, page);
    if (current === page) return;
    setPage(current);
    writeQuery({ q, status, page: current }, "replace");
  }, [loading, error, isFresh, tasks, page, q, status]);

  // T2：浏览器前进 / 后退，恢复输入、筛选、页码并重新发起对应查询。
  useEffect(() => {
    function onPopState() {
      const next = readQuery(window.location.search);
      setDraft(next.q);
      setQ(next.q);
      setStatus(next.status);
      setPage(next.page);
      retry();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [retry]);

  function search(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    setDraft(next);
    // 同一条件再次提交时 effect 依赖不变，这里显式重试（失败后的重试）。
    if (next === q) retry();
    else setQ(next);
    setPage(1);
    // 提交查询：trim 后页码回 1，并 replace 当前历史项。
    writeQuery({ q: next, status, page: 1 }, "replace");
  }

  function changeStatus(next: StatusFilter) {
    setStatus(next);
    setPage(1);
    // 筛选变化：push 历史项，页码回 1。
    writeQuery({ q, status: next, page: 1 }, "push");
  }

  function goToPage(next: number) {
    setPage(next);
    // 翻页：push 历史项。
    writeQuery({ q, status, page: next }, "push");
  }

  return (
    <>
      <header>
        <div className="brand">
          TaskBoard<span>任务看板</span>
        </div>
      </header>
      <main>
        <h1>项目任务</h1>
        <p className="subtitle">搜索、筛选和查看团队任务。</p>
        <form className="toolbar" onSubmit={search}>
          <label className="search">
            搜索任务
            <input
              placeholder="搜索任务标题"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </label>
          <label>
            状态
            <select
              value={status}
              onChange={(e) => changeStatus(e.target.value as StatusFilter)}
            >
              <option value="ALL">全部状态</option>
              <option value="TODO">待办</option>
              <option value="DOING">进行中</option>
              <option value="DONE">已完成</option>
            </select>
          </label>
          <button className="primary">查询</button>
        </form>
        <p className="count muted" aria-live="polite">
          {tasks.length}项任务
        </p>
        <section className="panel" aria-label="任务列表" aria-busy={loading}>
          <div className="table-row table-head">
            <span>任务</span>
            <span>状态</span>
            <span className="owner">负责人</span>
          </div>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : loading ? (
            <div role="status" className="state">
              正在查询…
            </div>
          ) : tasks.length === 0 ? (
            <div className="state">没有匹配的任务</div>
          ) : (
            view.items.map((t) => (
              <div className="table-row" key={t.id}>
                <div>
                  <div className="task-title">{t.title}</div>
                  <div className="task-detail">{t.description}</div>
                </div>
                <div>
                  <span className={"tag " + t.status}>{t.status}</span>
                </div>
                <span className="owner">{t.owner}</span>
              </div>
            ))
          )}
        </section>
        <nav className="pager" aria-label="分页">
          <button
            disabled={loading || view.current === 1}
            onClick={() => goToPage(view.current - 1)}
          >
            上一页
          </button>
          <span>
            第{view.current}页 共{view.pages}页
          </span>
          <button
            disabled={loading || view.current === view.pages}
            onClick={() => goToPage(view.current + 1)}
          >
            下一页
          </button>
        </nav>
      </main>
    </>
  );
}