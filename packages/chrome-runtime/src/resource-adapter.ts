import { execFile } from "node:child_process";
import { platform } from "node:os";

export interface ChromeRuntimeObservation {
	available: boolean;
	resourceVersion?: string;
	extensionLoaded: boolean;
}

export type ChromeRuntimeProbe = () => Promise<ChromeRuntimeObservation>;

function readVersion(command: string): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		execFile(command, ["--version"], { timeout: 5_000 }, (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			const version = stdout.trim();
			resolve(version.length > 0 ? version : undefined);
		});
	});
}

function candidateCommands(chromeExecutablePath?: string): string[] {
	const explicit =
		chromeExecutablePath === undefined ? [] : [chromeExecutablePath];
	const os = platform();
	if (os === "darwin") {
		return [
			...explicit,
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"google-chrome",
			"chromium",
		];
	}
	if (os === "linux") {
		return [
			...explicit,
			"google-chrome",
			"google-chrome-stable",
			"chromium",
			"chromium-browser",
		];
	}
	return [...explicit, "google-chrome", "chromium"];
}

export async function probeChromeRuntime(
	chromeExecutablePath?: string,
): Promise<ChromeRuntimeObservation> {
	for (const command of candidateCommands(chromeExecutablePath)) {
		const resourceVersion = await readVersion(command);
		if (resourceVersion !== undefined) {
			return { available: true, resourceVersion, extensionLoaded: false };
		}
	}
	return { available: false, extensionLoaded: false };
}
