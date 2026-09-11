import type { AgentTool, ToolApprovalDecision } from "@oh-my-pi/pi-agent-core";
import type { Static, TSchema, ToolNamespace } from "@oh-my-pi/pi-ai";
import type { Settings } from "../config/settings";
import { nativeParams } from "./bridge";

export interface HarnessFacadeHost {
	readonly settings: Settings;
}

export interface HarnessFacadeSpec<TWire extends TSchema = TSchema, TParams = unknown> {
	readonly target: string;
	readonly wireName: string;
	readonly replacesTarget?: true;
	readonly namespace?: ToolNamespace;
	readonly description: string;
	readonly parameters: TWire;
	readonly intent?: (args: Partial<Static<TWire>>) => string | undefined;
	toParams(args: Static<TWire>, host: HarnessFacadeHost): TParams;
}

function withPolicyKey(decision: ToolApprovalDecision | undefined, policyKey: string): ToolApprovalDecision {
	if (decision === undefined) return { tier: "exec", policyKey };
	if (typeof decision === "string") return { tier: decision, policyKey };
	return { policyKey, ...decision };
}

function mapPredicate<T>(
	value: T | ((args: never) => T) | undefined,
	toParams: (args: unknown) => unknown,
	fallback: T,
): T | ((args: unknown) => T) | undefined {
	if (typeof value !== "function") return value;
	const fn = value as (args: unknown) => T;
	return (args: unknown) => {
		try {
			return fn(toParams(args));
		} catch {
			return fallback;
		}
	};
}

export function harnessFacade(target: AgentTool, spec: HarnessFacadeSpec, host: HarnessFacadeHost): AgentTool {
	const toParams = (args: unknown): unknown => nativeParams(spec.toParams(args as never, host) as object);
	const approval = target.approval;
	return {
		name: spec.wireName,
		persistAs: target.name,
		label: target.label,
		description: spec.description,
		parameters: spec.parameters,
		loadMode: "essential",
		...(spec.namespace ? { namespace: spec.namespace } : {}),
		...(spec.intent ? { intent: spec.intent as AgentTool["intent"] } : {}),
	approval: (args: unknown): ToolApprovalDecision => {
		try {
			return withPolicyKey(typeof approval === "function" ? approval(toParams(args)) : approval, target.name);
		} catch {
			return { tier: "exec", policyKey: target.name };
		}
	},
	...(target.formatApprovalDetails
		? {
				formatApprovalDetails: (args: unknown) => {
					try {
						return target.formatApprovalDetails?.(toParams(args));
					} catch {
						return undefined;
					}
				},
			}
		: {}),
	...(target.concurrency !== undefined
		? { concurrency: mapPredicate(target.concurrency, toParams, "exclusive") as AgentTool["concurrency"] }
		: {}),
	...(target.interruptible !== undefined
		? { interruptible: mapPredicate(target.interruptible, toParams, false) as AgentTool["interruptible"] }
		: {}),
		execute: (toolCallId, args, signal, onUpdate, context) =>
			target.execute(toolCallId, toParams(args) as never, signal, onUpdate, context),
	};
}
