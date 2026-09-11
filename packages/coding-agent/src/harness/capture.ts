import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type } from "@oh-my-pi/omptype";
import type { Model } from "@oh-my-pi/pi-ai";
import {
	claudeCodeBillingHeaderPrefix,
	claudeCodeEntrypoint,
	claudeCodeSystemInstruction,
} from "@oh-my-pi/pi-ai/providers/claude-code-fingerprint";
import { type HarnessProfile, resolveHarnessProfile } from "@oh-my-pi/pi-catalog/compat/harness";
import { getHarnessCacheDir, isEnoent, logger } from "@oh-my-pi/pi-utils";

export const HARNESS_CAPTURE_SCHEMA = 1;

const HARNESS_ENTRYPOINTS: Readonly<Record<HarnessProfile, readonly string[]>> = {
	"claude-code": [claudeCodeEntrypoint],
	codex: ["codex_exec"],
};

interface WireOwnedLeading {
	readonly linePrefixes: readonly string[];
	readonly lines: readonly string[];
	readonly identityBlock: boolean;
}

const WIRE_OWNED_LEADING: Readonly<Record<HarnessProfile, WireOwnedLeading>> = {
	"claude-code": {
		linePrefixes: [claudeCodeBillingHeaderPrefix],
		lines: [claudeCodeSystemInstruction],
		identityBlock: true,
	},
	codex: { linePrefixes: [], lines: [], identityBlock: false },
};

export const AMBIENT_CONTAINMENT_MIN_CHARS = 64;

const captureSchema = type({
	schema: "number",
	profile: "string",
	clientVersion: "string",
	entrypoint: "string",
	"capturedAt?": "string",
	instructions: "string[]",
	tools: "string[]",
	"ambient?": "string[]",
	"fallback?": "unknown",
});

export type HarnessCapture = typeof captureSchema.infer;

export interface HarnessPrompt {
	readonly text: string;
	readonly clientVersion: string;
	readonly path: string;
}

type CaptureProjection =
	| { readonly ok: true; readonly text: string; readonly clientVersion: string; readonly capturedAt: number }
	| { readonly ok: false; readonly reason: string };

function stripWireOwnedLines(block: string, wireOwned: WireOwnedLeading): string {
	let text = block;
	for (;;) {
		const trimmed = text.trimStart();
		const breakAt = trimmed.indexOf("\n");
		const line = (breakAt === -1 ? trimmed : trimmed.slice(0, breakAt)).trimEnd();
		const owned = wireOwned.lines.includes(line) || wireOwned.linePrefixes.some(prefix => line.startsWith(prefix));
		if (!owned) return text;
		if (breakAt === -1) return "";
		text = trimmed.slice(breakAt + 1);
	}
}

const SESSION_PATH_TOKEN =
	/(?<![A-Za-z0-9_:.])(?:\/(?:home|Users|root|data|tmp|var|private)(?:\/\S*)?|[A-Za-z]:[\\/]\S*|\\\\[^\s"'`]+)/g;

const REDACTED_SESSION_PATH = "[redacted-session-path]";

const TRAILING_FENCE = /[`'"')\]}.,;:!?]+$/;

function redactSessionPaths(block: string): string {
	return block.replace(SESSION_PATH_TOKEN, token => {
		const exposed = token.replace(TRAILING_FENCE, "");
		if (exposed.length === 0) return token;
		return `${REDACTED_SESSION_PATH}${token.slice(exposed.length)}`;
	});
}

function isAmbient(block: string, ambient: readonly string[]): boolean {
	for (const entry of ambient) {
		const needle = entry.trim();
		if (needle.length === 0) continue;
		if (block === needle) return true;
		if (needle.length >= AMBIENT_CONTAINMENT_MIN_CHARS && block.includes(needle)) return true;
	}
	return false;
}

export function projectHarnessCapture(profile: HarnessProfile, raw: unknown): CaptureProjection {
	const capture = captureSchema(raw);
	if (capture instanceof type.errors) return { ok: false, reason: capture.summary };
	if (capture.schema !== HARNESS_CAPTURE_SCHEMA) return { ok: false, reason: "schema-mismatch" };
	if (capture.profile !== profile) return { ok: false, reason: "profile-mismatch" };
	if (!HARNESS_ENTRYPOINTS[profile].includes(capture.entrypoint)) return { ok: false, reason: "entrypoint-mismatch" };
	if (capture.fallback !== undefined && capture.fallback !== null) return { ok: false, reason: "fallback-marker" };
	if (capture.clientVersion.trim().length === 0) return { ok: false, reason: "client-version-empty" };
	if (capture.tools.every(tool => tool.trim().length === 0)) return { ok: false, reason: "tools-empty" };
	const wireOwned = WIRE_OWNED_LEADING[profile];
	const ambient = capture.ambient ?? [];
	const blocks: string[] = [];
	let leading = true;
	let afterBillingHeader = false;
	for (const instruction of capture.instructions) {
		const text = leading ? stripWireOwnedLines(instruction, wireOwned) : instruction;
		const compared = text.trim();
		if (compared.length === 0) {
			afterBillingHeader =
				leading && wireOwned.linePrefixes.some(prefix => instruction.trimStart().startsWith(prefix));
			continue;
		}
		if (afterBillingHeader && wireOwned.identityBlock && !compared.includes("\n")) {
			afterBillingHeader = false;
			continue;
		}
		afterBillingHeader = false;
		if (isAmbient(compared, ambient)) continue;
		leading = false;
		const scrubbed = redactSessionPaths(text);
		blocks.push(scrubbed);
	}
	if (blocks.length === 0) return { ok: false, reason: "instructions-empty" };
	const capturedAt = capture.capturedAt === undefined ? Number.NaN : Date.parse(capture.capturedAt);
	return {
		ok: true,
		text: blocks.join("\n\n"),
		clientVersion: capture.clientVersion,
		capturedAt: Number.isNaN(capturedAt) ? 0 : capturedAt,
	};
}

const resolvedPrompts = new Map<HarnessProfile, Promise<HarnessPrompt | null>>();
const servedPrompts = new Map<HarnessProfile, HarnessPrompt>();

export function loadHarnessPrompt(profile: HarnessProfile): Promise<HarnessPrompt | null> {
	const cached = resolvedPrompts.get(profile);
	if (cached) return cached;
	const pending = readHarnessPrompt(profile).then(prompt => {
		if (prompt !== null) servedPrompts.set(profile, prompt);
		return prompt;
	});
	resolvedPrompts.set(profile, pending);
	return pending;
}

export function servedHarnessPrompt(model: Model | undefined): HarnessPrompt | undefined {
	if (model === undefined || servedPrompts.size === 0) return undefined;
	const profile = resolveHarnessProfile(model);
	return profile === undefined ? undefined : servedPrompts.get(profile);
}

export function resetHarnessPromptCache(): void {
	resolvedPrompts.clear();
	servedPrompts.clear();
}

async function readHarnessPrompt(profile: HarnessProfile): Promise<HarnessPrompt | null> {
	const dir = path.join(getHarnessCacheDir(), profile);
	let names: string[];
	try {
		names = await fs.readdir(dir);
	} catch (error) {
		logger.debug("No harness capture directory; using omp's native prompt", {
			profile,
			dir,
			...(isEnoent(error) ? {} : { error: String(error) }),
		});
		return null;
	}
	const files = names.filter(name => name.endsWith(".json")).sort();
	let best: HarnessPrompt | undefined;
	let bestCapturedAt = 0;
	for (const name of files) {
		const file = path.join(dir, name);
		let raw: unknown;
		try {
			raw = await Bun.file(file).json();
		} catch (error) {
			logger.debug("Harness capture unreadable; ignoring it", { profile, file, error: String(error) });
			continue;
		}
		const projection = projectHarnessCapture(profile, raw);
		if (!projection.ok) {
			logger.debug("Harness capture rejected; ignoring it", { profile, file, reason: projection.reason });
			continue;
		}
		if (best !== undefined && projection.capturedAt <= bestCapturedAt) continue;
		best = { text: projection.text, clientVersion: projection.clientVersion, path: file };
		bestCapturedAt = projection.capturedAt;
	}
	if (best === undefined) {
		logger.debug("No valid harness capture; using omp's native prompt", { profile, dir, candidates: files.length });
		return null;
	}
	logger.debug("Serving the harness prompt from a cached capture", {
		profile,
		file: best.path,
		clientVersion: best.clientVersion,
		chars: best.text.length,
	});
	return best;
}
