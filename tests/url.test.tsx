import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../src/App";
import { readQuery } from "../src/query";

const search = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("T2 URL 参数读取（纯函数）", () => {
  it("缺省时 q 为空、status 为 ALL、page 为 1", () => {
    expect(readQuery("")).toEqual({ q: "", status: "ALL", page: 1 });
    expect(readQuery("?foo=bar")).toEqual({ q: "", status: "ALL", page: 1 });
  });

  it("未知或非法 status 回落到 ALL，合法值保留", () => {
    expect(readQuery("?status=ALL").status).toBe("ALL");
    expect(readQuery("?status=TODO").status).toBe("TODO");
    expect(readQuery("?status=DOING").status).toBe("DOING");
    expect(readQuery("?status=DONE").status).toBe("DONE");
    expect(readQuery("?status=ONGOING").status).toBe("ALL");
    expect(readQuery("?status=").status).toBe("ALL");
  });

  it("非法 page 一律回落到 1，合法正整数保留", () => {
    for (const raw of ["0", "-1", "-2", "1.5", "abc", "", "1e3", "3px", "9007199254740993", " 2"]) {
      expect(readQuery(`?page=${raw}`).page, `page=${raw}`).toBe(1);
    }
    expect(readQuery("?page=1").page).toBe(1);
    expect(readQuery("?page=2").page).toBe(2);
    expect(readQuery("?page=99").page).toBe(99);
  });

  it("中文、空格与 & 按 URL 编码解码", () => {
    expect(readQuery("?q=%E6%8E%A5%E5%8F%A3&status=DOING&page=2")).toEqual({
      q: "接口",
      status: "DOING",
      page: 2,
    });
    expect(readQuery("?q=a%26b").q).toBe("a&b");
    expect(readQuery("?q=a+b").q).toBe("a b");
  });
});

describe("T2 URL 状态恢复与同步（App）", () => {
  it("首次进入从 URL 恢复搜索词、筛选与页码，输入框同步", async () => {
    window.history.replaceState(null, "", "/?q=%E6%8E%A5%E5%8F%A3&status=DOING&page=1");
    render(<App />);

    expect((screen.getByPlaceholderText("搜索任务标题") as HTMLInputElement).value).toBe("接口");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("DOING");
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
  });

  it("题目示例 URL ?q=接口&status=DOING&page=2：成功后被钳制回第 1 页并去掉越界 page", async () => {
    window.history.replaceState(null, "", "/?q=%E6%8E%A5%E5%8F%A3&status=DOING&page=2");
    const before = window.history.length;
    render(<App />);

    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(search().get("q")).toBe("接口");
      expect(search().get("status")).toBe("DOING");
      expect(search().has("page")).toBe(false);
    });
    expect(window.history.length).toBe(before);
  });
  it("未提交的输入不写 URL", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("登录功能开发");

    const input = screen.getByPlaceholderText("搜索任务标题") as HTMLInputElement;
    await user.type(input, "接口");

    expect(input.value).toBe("接口");
    expect(window.location.search).toBe("");
  });

  it("点击查询：trim 搜索词、页码回 1 且 replace 当前历史项", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?status=DOING&page=2");
    render(<App />);
    expect(await screen.findByText("第2页 共2页")).toBeInTheDocument();

    const before = window.history.length;
    await user.type(screen.getByPlaceholderText("搜索任务标题"), "  接口  ");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => {
      expect(search().get("q")).toBe("接口");
      expect(search().get("status")).toBe("DOING");
      expect(search().has("page")).toBe(false);
    });
    expect(window.history.length).toBe(before);
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
  });

  it("筛选变化：push 历史项、页码回 1 并重新查询", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?status=DOING&page=2");
    render(<App />);
    expect(await screen.findByText("第2页 共2页")).toBeInTheDocument();

    const before = window.history.length;
    await user.selectOptions(screen.getByRole("combobox"), "ALL");

    await waitFor(() => expect(window.history.length).toBe(before + 1));
    expect(search().get("status")).toBe(null);
    expect(search().has("page")).toBe(false);
    expect(await screen.findByText("第1页 共4页")).toBeInTheDocument();
  });

  it("翻页：push 历史项并写入 page", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?status=DOING");
    render(<App />);
    expect(await screen.findByText("第1页 共2页")).toBeInTheDocument();

    const before = window.history.length;
    await user.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() => expect(search().get("page")).toBe("2"));
    expect(window.history.length).toBe(before + 1);
    expect(await screen.findByText("第2页 共2页")).toBeInTheDocument();
  });

  it("popstate 恢复输入、筛选与页码并重新发起查询", async () => {
    render(<App />);
    expect(await screen.findByText("登录功能开发")).toBeInTheDocument();

    window.history.pushState(null, "", "/?q=%E6%8E%A5%E5%8F%A3&status=DOING");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect((screen.getByPlaceholderText("搜索任务标题") as HTMLInputElement).value).toBe("接口");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("DOING");
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();
    expect(screen.queryByText("登录功能开发")).not.toBeInTheDocument();
  });

  it("空结果保持第 1 页 / 共 1 页，并去掉越界 page", async () => {
    window.history.replaceState(null, "", "/?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&page=3");
    render(<App />);

    expect(await screen.findByText("没有匹配的任务")).toBeInTheDocument();
    expect(screen.getByText("第1页 共1页")).toBeInTheDocument();
    await waitFor(() => expect(search().has("page")).toBe(false));
  });

  it("越界页码只在查询成功后才用 replace 钳制，不新增历史项", async () => {
    window.history.replaceState(null, "", "/?status=DOING&page=9");
    const before = window.history.length;
    render(<App />);

    // 请求仍在飞行：不得用加载前的空列表提前把恢复出来的 page 改成 1
    expect(search().get("page")).toBe("9");

    expect(await screen.findByText("第2页 共2页")).toBeInTheDocument();
    await waitFor(() => expect(search().get("page")).toBe("2"));
    expect(window.history.length).toBe(before);
  });

  it("不能用上一次查询的结果提前钳制恢复出来的页码", async () => {
    window.history.replaceState(null, "", "/?q=%E6%8E%A5%E5%8F%A3");
    render(<App />);
    // 用真实任务标题确认“接口”查询确已完成（空列表时分页器也显示“第1页 共1页”）
    expect(await screen.findByText("任务列表接口对接")).toBeInTheDocument();

    window.history.pushState(null, "", "/?page=3");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    // 旧的“接口”结果只有 1 页，不得立刻把 page=3 改写成 1
    expect(search().get("page")).toBe("3");
    expect(await screen.findByText("第3页 共4页")).toBeInTheDocument();
    expect(search().get("page")).toBe("3");
  });

  it("保留无关参数与 hash，并省略默认参数", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?foo=1&bar=2#section");
    render(<App />);
    await screen.findByText("登录功能开发");

    await user.type(screen.getByPlaceholderText("搜索任务标题"), "接口");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(search().get("q")).toBe("接口"));
    expect(search().get("foo")).toBe("1");
    expect(search().get("bar")).toBe("2");
    expect(search().has("status")).toBe(false);
    expect(search().has("page")).toBe(false);
    expect(window.location.hash).toBe("#section");
  });

  it("中文、空格与 & 由 URLSearchParams 编码，不破坏参数边界", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("登录功能开发");

    await user.type(screen.getByPlaceholderText("搜索任务标题"), "  a&b 中文  ");
    await user.click(screen.getByRole("button", { name: "查询" }));

    await waitFor(() => expect(search().get("q")).toBe("a&b 中文"));
    // & 若未被编码，会被解析成第二个参数
    expect(window.location.search.split("&").filter((part) => part.length > 0)).toHaveLength(1);
  });
});