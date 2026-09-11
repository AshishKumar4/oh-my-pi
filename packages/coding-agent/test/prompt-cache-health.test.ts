import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	formatPromptCacheHealth,
	PROMPT_CACHE_HEALTH_MIN_SAMPLES,
	PROMPT_CACHE_HEALTH_RING_SIZE,
	PromptCacheHealthTracker,
	promptCacheEma,
	promptCacheHealth,
	promptCacheHealthForSession,
	promptCacheHitRatio,
	promptCacheP95,
	promptCacheSamplesFromMessages,
	type PromptCacheSample,
} from "@oh-my-pi/pi-coding-agent/session/prompt-cache-stats";

const REQ1: PromptCacheSample = { input: 4, cacheRead: 17124, cacheWrite: 10431 };
const REQ2: PromptCacheSample = { input: 2, cacheRead: 27555, cacheWrite: 95 };
const REQ3: PromptCacheSample = { input: 2, cacheRead: 27650, cacheWrite: 170 };
const REQ5: PromptCacheSample = { input: 2, cacheRead: 27900, cacheWrite: 156 };
const REQ8: PromptCacheSample = { input: 2, cacheRead: 28292, cacheWrite: 140 };
const SESSION = [REQ1, REQ2, REQ3, REQ5, REQ8];

function ratiosOf(samples: PromptCacheSample[]): number[] {
	const ratios: number[] = [];
	for (const sample of samples) {
		const ratio = promptCacheHitRatio(sample);
		if (ratio !== undefined) ratios.push(ratio);
	}
	return ratios;
}

describe("promptCacheHitRatio", () => {
	it("divides cacheRead by the full prompt including cacheWrite", () => {
		expect(promptCacheHitRatio(REQ1)).toBeCloseTo(0.6214, 3);
		expect(promptCacheHitRatio(REQ2)).toBeCloseTo(0.9965, 3);
		expect(promptCacheHitRatio(REQ8)).toBeCloseTo(0.995, 3);
	});

	it("skips requests with no prompt tokens", () => {
		expect(promptCacheHitRatio({ input: 0, cacheRead: 0, cacheWrite: 0 })).toBeUndefined();
	});
});

describe("promptCacheEma", () => {
	it("seeds with the first ratio and tracks a cold-start recovery within a handful of turns", () => {
		const ratios = ratiosOf(SESSION);
		expect(ratios).toHaveLength(5);
		expect(promptCacheEma([ratios[0]])).toBeCloseTo(0.6214, 3);
		expect(promptCacheEma(ratios)).toBeCloseTo(0.9051, 3);
	});

	it("weights recent requests more than older ones", () => {
		const ratios = ratiosOf(SESSION);
		const forward = promptCacheEma(ratios) ?? 0;
		const reversed = promptCacheEma([...ratios].reverse()) ?? 0;
		expect(reversed).toBeLessThan(forward);
	});

	it("is undefined without ratios", () => {
		expect(promptCacheEma([])).toBeUndefined();
	});
});

describe("promptCacheP95", () => {
	it("returns the nearest-rank P95 of a known sample set", () => {
		expect(promptCacheP95(ratiosOf(SESSION))).toBeCloseTo(0.9965, 3);
		expect(promptCacheP95([0.5, 0.9, 0.7])).toBe(0.9);
	});

	it("is undefined without ratios", () => {
		expect(promptCacheP95([])).toBeUndefined();
	});
});

describe("promptCacheHealth", () => {
	it("pairs EMA with P95 once the sample floor is met", () => {
		const health = promptCacheHealth(SESSION);
		expect(health?.samples).toBe(5);
		expect(health?.ema).toBeCloseTo(0.9051, 3);
		expect(health?.p95).toBeCloseTo(0.9965, 3);
	});

	it("holds P95 back as a placeholder below the sample floor", () => {
		expect(PROMPT_CACHE_HEALTH_MIN_SAMPLES).toBe(5);
		const health = promptCacheHealth([REQ2, REQ3]);
		if (!health) throw new Error("Expected health for two warm requests");
		expect(health.samples).toBe(2);
		expect(health.p95).toBeUndefined();
		expect(formatPromptCacheHealth(health)).toEqual({ kind: "warming", body: "cache …" });
	});

	it("renders full and compact bodies once ready", () => {
		const health = promptCacheHealth(SESSION);
		if (!health) throw new Error("Expected health for the five-request session");
		expect(formatPromptCacheHealth(health)).toEqual({
			kind: "ready",
			full: "cache 91% ema / 100% p95",
			compact: "cache 91/100",
		});
	});

	it("skips zero-denominator requests instead of dragging the average", () => {
		const health = promptCacheHealth([{ input: 0, cacheRead: 0, cacheWrite: 0 }, REQ2]);
		expect(health?.samples).toBe(1);
		expect(health?.ema).toBeCloseTo(0.9965, 3);
	});

	it("is undefined when no request carried prompt tokens", () => {
		expect(promptCacheHealth([{ input: 0, cacheRead: 0, cacheWrite: 0 }])).toBeUndefined();
		expect(promptCacheHealth([])).toBeUndefined();
	});
});

describe("promptCacheSamplesFromMessages", () => {
	it("samples assistant usage in arrival order and ignores the rest", () => {
		const messages: AgentMessage[] = [
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "first" }],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-opus-5",
				usage: {
					input: REQ1.input,
					output: 10,
					cacheRead: REQ1.cacheRead,
					cacheWrite: REQ1.cacheWrite,
					totalTokens: REQ1.input + REQ1.cacheRead + REQ1.cacheWrite + 10,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "second" }],
				api: "anthropic",
				provider: "anthropic",
				model: "claude-opus-5",
				usage: {
					input: REQ2.input,
					output: 10,
					cacheRead: REQ2.cacheRead,
					cacheWrite: REQ2.cacheWrite,
					totalTokens: REQ2.input + REQ2.cacheRead + REQ2.cacheWrite + 10,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 3,
			},
		];
		const samples = promptCacheSamplesFromMessages(messages);
		expect(samples.map(sample => sample.cacheWrite)).toEqual([REQ1.cacheWrite, REQ2.cacheWrite]);
	});
});

describe("PromptCacheHealthTracker", () => {
	it("matches the batch rollup while the window holds every sample", () => {
		const tracker = new PromptCacheHealthTracker();
		for (const sample of SESSION) tracker.add(sample);
		expect(tracker.health()).toEqual(promptCacheHealth(SESSION));
	});

	it("skips zero-denominator requests without seeding the EMA", () => {
		const tracker = new PromptCacheHealthTracker();
		tracker.add({ input: 0, cacheRead: 0, cacheWrite: 0 });
		expect(tracker.health()).toBeUndefined();
		tracker.add(REQ2);
		expect(tracker.health()?.samples).toBe(1);
		expect(tracker.health()?.ema).toBeCloseTo(0.9965, 3);
	});

	it("bounds P95 to the last ring window while the EMA still tracks every request", () => {
		expect(PROMPT_CACHE_HEALTH_RING_SIZE).toBe(100);
		const ratios: number[] = [];
		const tracker = new PromptCacheHealthTracker();
		for (let index = 0; index < 10000; index += 1) {
			const hot = index >= 9900;
			const sample: PromptCacheSample = hot
				? { input: 10, cacheRead: 990, cacheWrite: 0 }
				: { input: 900, cacheRead: 100, cacheWrite: 0 };
			ratios.push(hot ? 0.99 : 0.1);
			tracker.add(sample);
		}
		const health = tracker.health();
		if (!health) throw new Error("Expected health for ten thousand requests");
		expect(health.samples).toBe(10000);
		const expectedEma = promptCacheEma(ratios);
		if (expectedEma === undefined) throw new Error("Expected EMA for ten thousand ratios");
		expect(health.ema).toBe(expectedEma);
		expect(health.p95).toBe(promptCacheP95(ratios.slice(-PROMPT_CACHE_HEALTH_RING_SIZE)));
		expect(health.p95).toBeCloseTo(0.99, 3);
		expect(promptCacheP95(ratios)).toBeCloseTo(0.1, 3);
	});
});

describe("promptCacheHealthForSession", () => {
	function assistantTurn(sample: PromptCacheSample, timestamp: number): AgentMessage {
		return {
			role: "assistant",
			content: [{ type: "text", text: `turn ${timestamp}` }],
			api: "anthropic",
			provider: "anthropic",
			model: "claude-opus-5",
			usage: {
				input: sample.input,
				output: 10,
				cacheRead: sample.cacheRead,
				cacheWrite: sample.cacheWrite,
				totalTokens: sample.input + sample.cacheRead + sample.cacheWrite + 10,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp,
		};
	}

	function sessionOf(samples: PromptCacheSample[]): { messages: AgentMessage[] } {
		return { messages: samples.map((sample, index) => assistantTurn(sample, index + 1)) };
	}

	it("matches the batch rollup and holds steady across renders with no arrivals", () => {
		const session = sessionOf(SESSION);
		expect(promptCacheHealthForSession(session)).toEqual(promptCacheHealth(SESSION));
		expect(promptCacheHealthForSession(session)).toEqual(promptCacheHealth(SESSION));
	});

	it("rebuilds after a history swap instead of double-counting", () => {
		const session = sessionOf(SESSION);
		expect(promptCacheHealthForSession(session)?.samples).toBe(5);
		session.messages = sessionOf([REQ2]).messages;
		expect(promptCacheHealthForSession(session)?.samples).toBe(1);
		session.messages = [];
		expect(promptCacheHealthForSession(session)).toBeUndefined();
	});

	it("picks up appended turns without rescanning the prefix", () => {
		const session = sessionOf([REQ2, REQ3]);
		expect(promptCacheHealthForSession(session)?.p95).toBeUndefined();
		for (const sample of [REQ1, REQ5, REQ8]) session.messages.push(assistantTurn(sample, 99));
		expect(promptCacheHealthForSession(session)).toEqual(promptCacheHealth([REQ2, REQ3, REQ1, REQ5, REQ8]));
	});

	it("rebuilds after a same-array shrink", () => {
		const session = sessionOf(SESSION);
		expect(promptCacheHealthForSession(session)?.samples).toBe(5);
		session.messages.pop();
		expect(promptCacheHealthForSession(session)?.samples).toBe(4);
	});

	it("treats a session without messages as empty", () => {
		expect(promptCacheHealthForSession({})).toBeUndefined();
		expect(promptCacheHealthForSession({ messages: undefined })).toBeUndefined();
	});
});
