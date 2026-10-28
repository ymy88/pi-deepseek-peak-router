/**
 * DeepSeek 高峰期路由。
 *
 * 注册虚拟模型 `deepseek/auto`：
 * - 工作日 UTC 01:00-04:00 与 06:00-10:00（DeepSeek 高峰价窗口）走 OpenRouter 的 DeepInfra 端点；
 * - 其余时段走 DeepSeek 官方的 deepseek-flash；
 * - 官方端点因容量不足失败时，把那次重试改送到 OpenRouter。
 *
 * 只在用户发新消息时重新判断，工具结果之后的续跑粘在上一个模型上，避免回合中途换模型丢提示缓存。
 * 用法：pi --model deepseek/auto
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Endpoint = "official" | "openrouter";

export type RouteReason = "user" | "continuation" | "retry" | "direct";

export interface EndpointChoice {
	reason: RouteReason;
	peak: boolean;
	previous?: Endpoint;
	failed?: { endpoint: Endpoint; errorMessage?: string };
}

const OFFICIAL_PROVIDER = "deepseek";
const OFFICIAL_MODEL = "deepseek-flash";
const OPENROUTER_PROVIDER = "openrouter";
const OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash-1017";

/** 容量类失败：限流、超时、上游过载、服务不可用。 */
const CAPACITY_ERROR = /rate.?limit|429|overload|timed?\s*out|timeout|ETIMEDOUT|50[23]|capacity/i;

/**
 * DeepSeek 的高峰价窗口：UTC 01:00-04:00 与 06:00-10:00，周一至周五。
 * 两个窗口都是起点包含、终点不包含，所以 04:00 整和 10:00 整属于平峰。
 * 周末与中国的法定节假日在官方规则里全天平峰；节假日没有实现。
 */
export function isPeak(at: Date): boolean {
	const day = at.getUTCDay();
	if (day === 0 || day === 6) return false;
	const hour = at.getUTCHours();
	return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function isCapacityError(message?: string): boolean {
	return message !== undefined && CAPACITY_ERROR.test(message);
}

export function chooseEndpoint(choice: EndpointChoice): Endpoint {
	const { reason, peak, previous, failed } = choice;

	if (reason === "retry" && failed) {
		if (failed.endpoint === "official" && isCapacityError(failed.errorMessage)) return "openrouter";
		return failed.endpoint;
	}
	if (reason === "continuation" && previous) return previous;
	return peak ? "openrouter" : "official";
}

function endpointOf(provider: string): Endpoint {
	return provider === OPENROUTER_PROVIDER ? "openrouter" : "official";
}

export default function (pi: ExtensionAPI) {
	pi.registerVirtualModel({
		provider: OFFICIAL_PROVIDER,
		id: "auto",
		name: "Auto (peak-priced)",
		thinkingLevels: ["low", "medium", "high", "xhigh"],
		// deepseek-flash 的限额；第一个回答之后 pi 改用实际回答那个模型的限额。
		contextWindow: 1_048_576,
		maxTokens: 384_000,
		route(request, ctx) {
			const official = ctx.modelRegistry.find(OFFICIAL_PROVIDER, OFFICIAL_MODEL);
			if (!official) throw new Error(`物理模型 ${OFFICIAL_PROVIDER}/${OFFICIAL_MODEL} 不在模型目录里`);
			const openrouter = ctx.modelRegistry.find(OPENROUTER_PROVIDER, OPENROUTER_MODEL);
			if (!openrouter) throw new Error(`物理模型 ${OPENROUTER_PROVIDER}/${OPENROUTER_MODEL} 不在模型目录里`);

			const endpoint = chooseEndpoint({
				reason: request.reason,
				peak: isPeak(new Date()),
				previous: request.previous ? endpointOf(request.previous.model.provider) : undefined,
				failed: request.failed
					? {
							endpoint: endpointOf(request.failed.model.provider),
							errorMessage: request.failed.message.errorMessage,
						}
					: undefined,
			});

			return {
				model: endpoint === "openrouter" ? openrouter : official,
				thinkingLevel: request.thinkingLevel,
			};
		},
	});
}
