import type { Model, Static, TSchema } from "@oh-my-pi/pi-ai";
import { type HarnessProfile, resolveHarnessProfile } from "@oh-my-pi/pi-catalog/compat/harness";

export interface HarnessSchemaBridge<TParams, TWire extends TSchema = TSchema> {
	readonly parameters: TWire;
	toParams(args: Static<TWire>): TParams;
}

export type HarnessBridges<TParams, TWire extends TSchema = TSchema> = Partial<
	Record<HarnessProfile, HarnessSchemaBridge<TParams, TWire>>
>;

interface BridgeHost {
	getActiveModel?: () => Model | undefined;
}

function activeBridge<TParams, TWire extends TSchema>(
	session: BridgeHost | null | undefined,
	bridges: HarnessBridges<TParams, TWire>,
): HarnessSchemaBridge<TParams, TWire> | undefined {
	const model = session?.getActiveModel?.();
	const profile = model === undefined ? undefined : resolveHarnessProfile(model);
	return profile === undefined ? undefined : bridges[profile];
}

export function harnessParameters<TNative extends TSchema, TWire extends TSchema>(
	session: BridgeHost | null | undefined,
	bridges: HarnessBridges<unknown, TWire>,
	native: TNative,
): TNative | TWire {
	return activeBridge(session, bridges)?.parameters ?? native;
}

const kNativeParams = Symbol("harness.nativeParams");

export function nativeParams<T extends object>(params: T): T {
	return Object.defineProperty(params, kNativeParams, { value: true });
}

export function harnessParams<TParams>(
	session: BridgeHost | null | undefined,
	bridges: HarnessBridges<TParams>,
	args: unknown,
): TParams {
	if (typeof args === "object" && args !== null && kNativeParams in args) return args as TParams;
	const bridge = activeBridge(session, bridges);
	return bridge ? bridge.toParams(args as never) : (args as TParams);
}
