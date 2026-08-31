import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ChromeExtensionState =
	| "ENABLED"
	| "DISABLED"
	| "MISSING"
	| "UNKNOWN";

type ChromeExtensionEntry = {
	path?: unknown;
	state?: unknown;
	disable_reasons?: unknown;
};

function defaultUserDataRoot(): string | undefined {
	if (process.platform === "darwin")
		return join(
			homedir(),
			"Library",
			"Application Support",
			"Google",
			"Chrome",
		);
	if (process.platform === "linux")
		return join(homedir(), ".config", "google-chrome");
	if (process.platform === "win32" && process.env.LOCALAPPDATA)
		return join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
	return undefined;
}
function entryState(
	entry: ChromeExtensionEntry,
	expectedLoadDir: string,
): ChromeExtensionState | undefined {
	if (typeof entry.path !== "string" || resolve(entry.path) !== expectedLoadDir)
		return undefined;
	const disabledByReason =
		Array.isArray(entry.disable_reasons) && entry.disable_reasons.length > 0;
	const disabledByState = entry.state === 0;
	return disabledByReason || disabledByState ? "DISABLED" : "ENABLED";
}

async function settingsFrom(
	path: string,
): Promise<Record<string, ChromeExtensionEntry>> {
	const raw = JSON.parse(await readFile(path, "utf8")) as {
		extensions?: { settings?: Record<string, ChromeExtensionEntry> };
	};
	return raw.extensions?.settings ?? {};
}

async function preferredProfiles(root: string): Promise<string[]> {
	let lastUsed: string | undefined;
	try {
		const localState = JSON.parse(
			await readFile(join(root, "Local State"), "utf8"),
		) as {
			profile?: { last_used?: unknown };
		};
		if (typeof localState.profile?.last_used === "string")
			lastUsed = localState.profile.last_used;
	} catch {}
	const entries = await readdir(root, { withFileTypes: true });
	const profiles = entries
		.filter(
			(entry) =>
				entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name),
		)
		.map((entry) => entry.name);
	return lastUsed && profiles.includes(lastUsed)
		? [lastUsed, ...profiles.filter((name) => name !== lastUsed)]
		: profiles;
}
export async function probeChromeExtensionState(input: {
	extensionId: string;
	loadDir: string;
	userDataRoot?: string;
}): Promise<ChromeExtensionState> {
	const root = input.userDataRoot ?? defaultUserDataRoot();
	if (!root) return "UNKNOWN";
	const expectedLoadDir = resolve(input.loadDir);
	try {
		const profiles = await preferredProfiles(root);
		let sawMatchingDisabled = false;
		for (const profile of profiles) {
			for (const file of ["Secure Preferences", "Preferences"]) {
				try {
					const settings = await settingsFrom(join(root, profile, file));
					const observed = entryState(
						settings[input.extensionId] ?? {},
						expectedLoadDir,
					);
					if (observed === "ENABLED") return "ENABLED";
					if (observed === "DISABLED") sawMatchingDisabled = true;
				} catch {}
			}
		}
		return sawMatchingDisabled ? "DISABLED" : "MISSING";
	} catch {
		return "UNKNOWN";
	}
}
