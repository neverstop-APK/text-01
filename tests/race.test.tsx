import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import App from "../src/App";
import { useTaskSearch } from "../src/useTaskSearch";
import type { StatusFilter } from "../src/types";

// 种子事实：标题含“登录”的任务 id 为 1/7/13/19，含“接口”的为 2/8/14/20。
const LOGIN_IDS = [1, 7, 13, 19];
const INTERFACE_IDS = [2, 8, 14, 20];

function renderSearch(q: string, status: StatusFilter = "ALL") {
  return renderHook(
    (props: { q: string; status: StatusFilter }) => useTaskSearch(props.q, props.status),
    { initialProps: { q, status } },
  );
}

// 用模拟时间推进，而不是等待真实时间，保证请求先后顺序可重复。
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("T1 异步竞态与请求生命周期", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("旧成功不得覆盖新结果（登录 450ms 未结束就改查 接口 200ms）", async () => {
    const { result, rerender } = renderSearch("登录");

    await advance(100); // 登录仍在飞行
    rerender({ q: "接口", status: "ALL" });

    await advance(200); // 接口先返回
    expect(result.current.tasks.map((t) => t.id)).toEqual(INTERFACE_IDS);

    await advance(300); // 迟到的登录结果若未被丢弃，会在这里覆盖列表
    expect(result.current.tasks.map((t) => t.id)).toEqual(INTERFACE_IDS);
    expect(result.current.error).toBe("");
    expect(result.current.loading).toBe(false);
  });

  it("旧失败不得污染新错误（失败 200ms 与新查询 200ms 竞争）", async () => {
    const { result, rerender } = renderSearch("失败");
    rerender({ q: "接口", status: "ALL" }); // 旧的失败查询必须立即失效

    await advance(200);
    expect(result.current.error).toBe("");
    expect(result.current.tasks.map((t) => t.id)).toEqual(INTERFACE_IDS);
    expect(result.current.loading).toBe(false);
  });

  it("新查询失败时展示新错误，且旧查询的成功不能冲掉它", async () => {
    const { result, rerender } = renderSearch("登录"); // 450ms 后本会成功

    await advance(50);
    rerender({ q: "失败", status: "ALL" }); // 200ms 后必然失败

    await advance(200);
    expect(result.current.error).toBe("模拟查询失败");
    expect(result.current.tasks).toHaveLength(0);

    await advance(300); // 旧的登录结果不得覆盖错误状态
    expect(result.current.error).toBe("模拟查询失败");
    expect(result.current.tasks).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it("旧请求先结束不得提前关闭新查询的 loading", async () => {
    const { result, rerender } = renderSearch("接口"); // 200ms

    await advance(50);
    rerender({ q: "登录", status: "ALL" }); // 450ms，新查询仍在飞行

    await advance(200); // 旧请求本应在此结束，新查询还没回来
    expect(result.current.loading).toBe(true);

    await advance(300);
    expect(result.current.loading).toBe(false);
    expect(result.current.tasks.map((t) => t.id)).toEqual(LOGIN_IDS);
  });

  it("组件离开时取消仍在进行的请求", () => {
    const { unmount } = renderSearch("登录");
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("失败后可以重试同一查询", async () => {
    const { result } = renderSearch("失败");
    await advance(200);
    expect(result.current.error).toBe("模拟查询失败");
    expect(result.current.loading).toBe(false);

    act(() => {
      result.current.retry();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe("");

    await advance(200);
    expect(result.current.error).toBe("模拟查询失败");
    expect(result.current.loading).toBe(false);
  });

  it("App 级复现：先查“登录”再查“接口”，旧结果不得覆盖新结果", async () => {
    render(<App />);

    await advance(200); // 初始查询（空搜索词）完成
    expect(screen.getByText("登录功能开发")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("搜索任务标题");
    const form = screen.getByRole("button", { name: "查询" }).closest("form");
    expect(form).not.toBeNull();

    fireEvent.change(input, { target: { value: "登录" } });
    fireEvent.submit(form!);

    await advance(50); // 登录 450ms 还没结束

    fireEvent.change(input, { target: { value: "接口" } });
    fireEvent.submit(form!);

    await advance(200); // 接口先返回
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();

    await advance(300); // 迟到的登录结果若未被丢弃，会在这里覆盖列表
    expect(screen.getByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByText("登录输入校验")).not.toBeInTheDocument();
  });
});