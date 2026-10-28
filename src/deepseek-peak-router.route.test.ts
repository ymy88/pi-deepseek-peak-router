/**
 * 直接调用扩展注册出来的 route()，验证时间判断真的落到了正确的物理模型上。
 * 单靠 chooseEndpoint 的单元测试无法发现 route() 里的 provider 推导或 modelRegistry.find 写错。
 */

import { afterEach, expect, test } from "bun:test";
import register from "./deepseek-peak-router";

const RealDate = Date;
const MID_PEAK = "2026-10-28T02:00:00Z"; // 周三，落在 01:00-04:00 窗口内
const MID_OFF_PEAK = "2026-10-28T12:00:00Z"; // 周三，窗口外

function freezeClock(iso: string) {
	globalThis.Date = class extends RealDate {
		constructor(...args: unknown[]) {
			if (args.length === 0) super(iso);
			else super(...(args as [number]));
		}
	} as DateConstructor;
}

afterEach(() => {
	globalThis.Date = RealDate;
});

type Definition = {
	route: (
		request: Record<string, unknown>,
		ctx: { modelRegistry: { find: (provider: string, id: string) => unknown } },
	) => { model: { provider: string; id: string }; thinkingLevel: string };
};

function capture(): Definition {
	let definition: Definition | undefined;
	register({
		registerVirtualModel: (d: Definition) => {
			definition = d;
		},
	} as never);
	if (!definition) throw new Error("扩展没有调用 registerVirtualModel");
	return definition;
}

const fakeModel = (provider: string, id: string) => ({ provider, id, api: "openai-completions" });

const fakeCtx = (missing?: "official" | "openrouter") => ({
	modelRegistry: {
		find: (provider: string, id: string) => {
			if (missing === "official" && provider === "deepseek") return undefined;
			if (missing === "openrouter" && provider === "openrouter") return undefined;
			return fakeModel(provider, id);
		},
	},
});

test("高峰时段的新消息落到 OpenRouter", () => {
	freezeClock(MID_PEAK);
	const route = capture().route;
	const result = route({ reason: "user", thinkingLevel: "high" }, fakeCtx());
	expect(result.model.provider).toBe("openrouter");
	expect(result.model.id).toBe("deepseek/deepseek-v4.1-flash-1017");
	expect(result.thinkingLevel).toBe("high");
});

test("平峰时段的新消息落到官方端点", () => {
	freezeClock(MID_OFF_PEAK);
	const result = capture().route({ reason: "user", thinkingLevel: "low" }, fakeCtx());
	expect(result.model.provider).toBe("deepseek");
	expect(result.model.id).toBe("deepseek-flash");
});

test("平峰开始的回合跨进高峰后，续跑留在官方端点", () => {
	freezeClock(MID_PEAK);
	const result = capture().route(
		{ reason: "continuation", thinkingLevel: "medium", previous: { model: fakeModel("deepseek", "deepseek-flash") } },
		fakeCtx(),
	);
	expect(result.model.provider).toBe("deepseek");
});

test("官方端点限流后的重试改走 OpenRouter", () => {
	freezeClock(MID_OFF_PEAK);
	const result = capture().route(
		{
			reason: "retry",
			thinkingLevel: "medium",
			failed: { model: fakeModel("deepseek", "deepseek-flash"), message: { errorMessage: "429 Too Many Requests" } },
		},
		fakeCtx(),
	);
	expect(result.model.provider).toBe("openrouter");
});

test("缺凭证的端点会抛错，而不是把请求发出去", () => {
	freezeClock(MID_PEAK);
	expect(() => capture().route({ reason: "user", thinkingLevel: "medium" }, fakeCtx("openrouter"))).toThrow(
		"openrouter/deepseek/deepseek-v4.1-flash-1017",
	);
});
