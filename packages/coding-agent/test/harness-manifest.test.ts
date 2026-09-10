import { describe, expect, it } from "bun:test";
import {
	CODEX_COLLABORATION_NAMESPACE,
	harnessDirectTools,
	harnessToolBinding,
	harnessWireRenames,
} from "../src/harness/manifest";

describe("harness manifests", () => {
	it("pins the codex table: two renames, delegation grouped, nothing else touched", () => {
		expect(harnessWireRenames("codex")).toEqual({ ask: "request_user_input", eval: "exec" });
		expect(harnessDirectTools("codex")).toEqual({ hub: true, task: true });
		expect(harnessToolBinding("codex", "task")).toEqual({ namespace: CODEX_COLLABORATION_NAMESPACE });
		expect(harnessToolBinding("codex", "hub")).toEqual({ namespace: CODEX_COLLABORATION_NAMESPACE });
	});

	it("pins the claude-code table: seven renames, no grouping", () => {
		expect(harnessWireRenames("claude-code")).toEqual({
			ask: "AskUserQuestion",
			bash: "Bash",
			edit: "Edit",
			read: "Read",
			task: "Agent",
			web_search: "WebSearch",
			write: "Write",
		});
		expect(harnessDirectTools("claude-code")).toEqual({});
	});
});
