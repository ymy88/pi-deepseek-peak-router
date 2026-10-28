import { expect, test } from "bun:test";
import { chooseEndpoint, isCapacityError, isPeak } from "./deepseek-peak-router";

const at = (iso: string) => new Date(iso);
// 2026-10-28 是周三，2026-10-31 是周六，2026-11-01 是周日。

test("工作日高峰窗口是半开区间", () => {
	expect(isPeak(at("2026-10-28T00:59:00Z"))).toBe(false);
	expect(isPeak(at("2026-10-28T01:00:00Z"))).toBe(true);
	expect(isPeak(at("2026-10-28T03:59:59Z"))).toBe(true);
	expect(isPeak(at("2026-10-28T04:00:00Z"))).toBe(false);
	expect(isPeak(at("2026-10-28T05:59:59Z"))).toBe(false);
	expect(isPeak(at("2026-10-28T06:00:00Z"))).toBe(true);
	expect(isPeak(at("2026-10-28T09:59:59Z"))).toBe(true);
	expect(isPeak(at("2026-10-28T10:00:00Z"))).toBe(false);
	expect(isPeak(at("2026-10-28T23:59:59Z"))).toBe(false);
});

test("周末永远不是高峰", () => {
	expect(isPeak(at("2026-10-31T02:00:00Z"))).toBe(false);
	expect(isPeak(at("2026-11-01T08:00:00Z"))).toBe(false);
});

test("只有容量类错误才触发兜底切换", () => {
	expect(isCapacityError("429 Too Many Requests")).toBe(true);
	expect(isCapacityError("upstream is overloaded")).toBe(true);
	expect(isCapacityError("request timed out after 120s")).toBe(true);
	expect(isCapacityError("400 invalid tool schema")).toBe(false);
	expect(isCapacityError(undefined)).toBe(false);
});

test("新消息重新判断，续跑粘住上一个模型，重试只在容量错误时切换", () => {
	const user = "user" as const;
	const continuation = "continuation" as const;
	const retry = "retry" as const;

	expect(chooseEndpoint({ reason: user, peak: true })).toBe("openrouter");
	expect(chooseEndpoint({ reason: user, peak: false })).toBe("official");
	// 回合中途跨进高峰时，保留上一个回答的模型。
	expect(chooseEndpoint({ reason: continuation, peak: true, previous: "official" })).toBe("official");
	expect(chooseEndpoint({ reason: continuation, peak: false, previous: "openrouter" })).toBe("openrouter");
	// 官方端点因容量失败时，无论当时是不是高峰都改走 OpenRouter。
	expect(
		chooseEndpoint({ reason: retry, peak: false, failed: { endpoint: "official", errorMessage: "429 Too Many Requests" } }),
	).toBe("openrouter");
	// 不是容量类的失败留在原处。
	expect(
		chooseEndpoint({ reason: retry, peak: false, failed: { endpoint: "official", errorMessage: "400 bad request" } }),
	).toBe("official");
	// 没有可粘住的模型时，按时间判断。
	expect(chooseEndpoint({ reason: retry, peak: true })).toBe("openrouter");
});
