import { afterEach, describe, expect, test, vi } from "bun:test";
import * as cascade from "../src/compat/cascade";
import { resolveHarnessProfile } from "../src/compat/harness";
import { getBundledModel } from "../src/models";

describe("resolveHarnessProfile", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("walks the rule cascade once per model object", () => {
		const astra = getBundledModel("openai-codex", "gpt-6-astra");
		const legacy = getBundledModel("openai-codex", "gpt-5.5");
		expect(resolveHarnessProfile(astra)).toBe("codex");
		expect(resolveHarnessProfile(legacy)).toBeUndefined();

		const spy = vi.spyOn(cascade, "resolveCascade");
		expect(resolveHarnessProfile(astra)).toBe("codex");
		expect(resolveHarnessProfile(astra)).toBe("codex");
		expect(resolveHarnessProfile(legacy)).toBeUndefined();
		expect(spy).not.toHaveBeenCalled();
	});

	test("a freshly built model object resolves its own profile", () => {
		const first = getBundledModel("openai-codex", "gpt-6-astra");
		resolveHarnessProfile(first);
		const second = getBundledModel("anthropic", "claude-fable-5");

		expect(resolveHarnessProfile(second)).toBe("claude-code");
	});
});
