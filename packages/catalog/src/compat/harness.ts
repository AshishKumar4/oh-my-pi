import type { Model } from "../types";
import { HARNESS_PROFILES } from "./axes";
import { resolveCascade } from "./cascade";

export type HarnessProfile = (typeof HARNESS_PROFILES)[number];

function isHarnessProfile(value: unknown): value is HarnessProfile {
	return typeof value === "string" && (HARNESS_PROFILES as readonly string[]).includes(value);
}

const RESOLVED_PROFILES = new WeakMap<Model, HarnessProfile | null>();

export function resolveHarnessProfile(model: Model): HarnessProfile | undefined {
	const memoized = RESOLVED_PROFILES.get(model);
	if (memoized !== undefined) return memoized ?? undefined;
	const { identity } = model;
	const profile = resolveCascade({
		provider: model.provider,
		api: model.api,
		class: identity.class,
		model: model.id,
		reasoning: Boolean(model.reasoning),
		...(identity.family !== undefined && { family: identity.family }),
		...(identity.revision !== undefined && { revision: identity.revision }),
	}).catalog.harnessProfile;
	const resolved = isHarnessProfile(profile) ? profile : null;
	RESOLVED_PROFILES.set(model, resolved);
	return resolved ?? undefined;
}
