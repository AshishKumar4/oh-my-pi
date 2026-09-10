import { jsonSchemaToTypeScript } from "@oh-my-pi/pi-ai/utils/schema/typescript";
import { arkToWireSchema, isArkSchema } from "@oh-my-pi/pi-ai/utils/schema/wire";
import type { HarnessProfile } from "@oh-my-pi/pi-catalog/compat/harness";
import { prompt } from "@oh-my-pi/pi-utils";
import { codeModeIdentifier } from "../../harness/code-mode-identifier";
import { harnessToolBinding } from "../../harness/manifest";
import codexExecTemplate from "../../prompts/tools/eval-codex-exec.md" with { type: "text" };

export interface CodexExecBridgedTool {
	readonly name: string;
	readonly parameters: unknown;
	readonly summary?: string;
}

interface RenderedTool {
	readonly identifier: string;
	readonly alias?: string;
	readonly summary?: string;
	readonly declaration: string;
}

interface RenderedGroup {
	readonly namespace?: string;
	readonly tools: RenderedTool[];
}

interface PlacedTool extends CodexExecBridgedTool {
	readonly namespace?: string;
}

function comparePlacedTools(left: PlacedTool, right: PlacedTool): number {
	if (left.namespace !== right.namespace) {
		if (left.namespace === undefined) return -1;
		if (right.namespace === undefined) return 1;
		return left.namespace < right.namespace ? -1 : 1;
	}
	if (left.name === right.name) return 0;
	return left.name < right.name ? -1 : 1;
}

function renderTool(profile: HarnessProfile, tool: PlacedTool): RenderedTool {
	const identifier = codeModeIdentifier(profile, tool.name);
	const schema = isArkSchema(tool.parameters) ? arkToWireSchema(tool.parameters) : tool.parameters;
	return {
		identifier,
		...(identifier === tool.name ? {} : { alias: tool.name }),
		...(tool.summary ? { summary: tool.summary } : {}),
		declaration: jsonSchemaToTypeScript(schema, { style: "codex", declarationName: identifier }),
	};
}

export function buildCodexExecDescription(args: {
	profile: HarnessProfile;
	tools: readonly CodexExecBridgedTool[];
	preludeDeclarations?: string;
}): string {
	const placed: PlacedTool[] = args.tools.map(tool => {
		const namespace = harnessToolBinding(args.profile, tool.name)?.namespace;
		return namespace === undefined ? tool : { ...tool, namespace };
	});
	placed.sort(comparePlacedTools);
	const groups: RenderedGroup[] = [];
	for (const tool of placed) {
		let group = groups.at(-1);
		if (group === undefined || group.namespace !== tool.namespace) {
			group = { namespace: tool.namespace, tools: [] };
			groups.push(group);
		}
		group.tools.push(renderTool(args.profile, tool));
	}
	return prompt.render(codexExecTemplate, {
		groups,
		...(args.preludeDeclarations ? { preludeDeclarations: args.preludeDeclarations } : {}),
	});
}
