import type { HarnessProfile } from "@oh-my-pi/pi-catalog/compat/harness";

export interface HarnessToolBinding {
	readonly wireName?: string;
	readonly namespace?: string;
}

const CLAUDE_CODE_BINDINGS: Readonly<Record<string, HarnessToolBinding>> = {
	bash: { wireName: "Bash" },
	read: { wireName: "Read" },
	write: { wireName: "Write" },
	edit: { wireName: "Edit" },
	task: { wireName: "Agent" },
	ask: { wireName: "AskUserQuestion" },
	web_search: { wireName: "WebSearch" },
};

export const CODEX_COLLABORATION_NAMESPACE = "collaboration";

const CODEX_BINDINGS: Readonly<Record<string, HarnessToolBinding>> = {
	eval: { wireName: "exec" },
	ask: { wireName: "request_user_input" },
	task: { namespace: CODEX_COLLABORATION_NAMESPACE },
	hub: { namespace: CODEX_COLLABORATION_NAMESPACE },
};

const MANIFESTS: Readonly<Record<HarnessProfile, Readonly<Record<string, HarnessToolBinding>>>> = {
	"claude-code": CLAUDE_CODE_BINDINGS,
	codex: CODEX_BINDINGS,
};

export function harnessToolBinding(
	profile: HarnessProfile | undefined,
	toolName: string,
): HarnessToolBinding | undefined {
	return profile === undefined ? undefined : MANIFESTS[profile][toolName];
}

function collectNamespacedTools(
	bindings: Readonly<Record<string, HarnessToolBinding>>,
): Readonly<Record<string, true>> {
	const names: Record<string, true> = {};
	for (const [name, binding] of Object.entries(bindings)) {
		if (binding.namespace !== undefined) names[name] = true;
	}
	return names;
}

const DIRECT_TOOLS: Readonly<Record<HarnessProfile, Readonly<Record<string, true>>>> = {
	"claude-code": collectNamespacedTools(CLAUDE_CODE_BINDINGS),
	codex: collectNamespacedTools(CODEX_BINDINGS),
};

export function harnessDirectTools(profile: HarnessProfile): Readonly<Record<string, true>> {
	return DIRECT_TOOLS[profile];
}

function collectWireRenames(bindings: Readonly<Record<string, HarnessToolBinding>>): Readonly<Record<string, string>> {
	const renames: Record<string, string> = {};
	for (const [name, binding] of Object.entries(bindings)) {
		if (binding.wireName !== undefined) renames[name] = binding.wireName;
	}
	return renames;
}

const WIRE_RENAMES: Readonly<Record<HarnessProfile, Readonly<Record<string, string>>>> = {
	"claude-code": collectWireRenames(CLAUDE_CODE_BINDINGS),
	codex: collectWireRenames(CODEX_BINDINGS),
};

export function harnessWireRenames(profile: HarnessProfile): Readonly<Record<string, string>> {
	return WIRE_RENAMES[profile];
}
