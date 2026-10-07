import type { Filters, StatusFilter } from "./types";

const STATUS_FILTERS: readonly StatusFilter[] = ["ALL", "TODO", "DOING", "DONE"];

function isStatusFilter(value: string | null): value is StatusFilter {
  return value !== null && (STATUS_FILTERS as readonly string[]).includes(value);
}

// 页码只接受正的安全整数：非数值、小数、负数、越界大数一律回落到 1。
function parsePage(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 1;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

/**
 * T2：从 location.search 恢复查询状态。
 * 缺省搜索词为空；缺省或未知状态回落到 ALL；非法页码回落到 1。
 * 无关参数与 hash 由 URLSearchParams + location 读写负责保留。
 */
export function readQuery(search: string): Filters {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  return {
    q: params.get("q") ?? "",
    status: isStatusFilter(status) ? status : "ALL",
    page: parsePage(params.get("page")),
  };
}

/**
 * T2：把查询状态写回地址栏。
 * 保留已有的无关参数与 hash；默认值（空搜索词 / ALL / 第 1 页）省略不写。
 * replace 用于提交与页码规范化，push 用于筛选变化和翻页。
 */
export function writeQuery(filters: Filters, mode: "push" | "replace"): void {
  const params = new URLSearchParams(window.location.search);

  if (filters.q === "") params.delete("q");
  else params.set("q", filters.q);

  if (filters.status === "ALL") params.delete("status");
  else params.set("status", filters.status);

  if (filters.page > 1) params.set("page", String(filters.page));
  else params.delete("page");

  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;

  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function pageOf<T>(items: T[], page: number, size = 6) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(pages, Math.max(1, page));
  return {
    items: items.slice((current - 1) * size, current * size),
    current,
    pages,
  };
}