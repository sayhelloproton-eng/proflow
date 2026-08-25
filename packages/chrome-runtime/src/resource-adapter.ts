import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

export interface ChromeRuntimeObservation {
	available: boolean;
	resourceVersion?: string;
}

export type ChromeRuntimeProbe = () => Promise<ChromeRuntimeObservation>;
export type ChromeRuntimeInstaller = () => Promise<ChromeRuntimeObservation>;
export type ChromeInstallCommandRunner = (
	command: string,
	args: readonly string[],
	timeoutMs: number,
) => Promise<void>;

const CHROME_VERSION_PROBE_TIMEOUT_MS = 15_000;
const CHROME_DOWNLOAD_TIMEOUT_MS = 180_000;
export const GOOGLE_CHROME_MAC_DMG =
	"https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg";

function runCommand(
	command: string,
	args: readonly string[],
	timeoutMs: number,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		execFile(command, [...args], { timeout: timeoutMs }, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function readVersion(command: string): Promise<string | undefined> {
	return new Promise<string | undefined>((resolve) => {
		execFile(
			command,
			["--version"],
			{ timeout: CHROME_VERSION_PROBE_TIMEOUT_MS },
			(error, stdout) => {
				if (error) {
					resolve(undefined);
					return;
				}
				const version = stdout.trim();
				resolve(version.length > 0 ? version : undefined);
			},
		);
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
			join(
				homedir(),
				"Applications",
				"Google Chrome.app",
				"Contents",
				"MacOS",
				"Google Chrome",
			),
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
			return { available: true, resourceVersion };
		}
	}
	return { available: false };
}

async function macApplicationRoot(): Promise<string> {
	try {
		await access("/Applications", constants.W_OK);
		return "/Applications";
	} catch {
		const userApplications = join(homedir(), "Applications");
		await mkdir(userApplications, { recursive: true, mode: 0o755 });
		return userApplications;
	}
}

export async function installChromeRuntime(
	options: {
		platformName?: NodeJS.Platform;
		run?: ChromeInstallCommandRunner;
		applicationRoot?: string;
		verify?: (executable: string) => Promise<ChromeRuntimeObservation>;
	} = {},
): Promise<ChromeRuntimeObservation> {
	const platformName = options.platformName ?? platform();
	if (platformName !== "darwin") {
		throw new Error("CHROME_AUTO_INSTALL_UNSUPPORTED");
	}
	const run = options.run ?? runCommand;
	const applicationRoot =
		options.applicationRoot ?? (await macApplicationRoot());
	const targetApp = join(applicationRoot, "Google Chrome.app");
	const temporaryRoot = await mkdtemp(
		join(tmpdir(), "proflow-chrome-install-"),
	);
	const dmgPath = join(temporaryRoot, "googlechrome.dmg");
	const mountPoint = join(temporaryRoot, "mount");
	let mounted = false;
	try {
		await mkdir(mountPoint);
		await run(
			"/usr/bin/curl",
			[
				"-fL",
				"--connect-timeout",
				"15",
				"--max-time",
				"180",
				"-o",
				dmgPath,
				GOOGLE_CHROME_MAC_DMG,
			],
			CHROME_DOWNLOAD_TIMEOUT_MS + 10_000,
		);
		await run(
			"/usr/bin/hdiutil",
			["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath],
			30_000,
		);
		mounted = true;
		await run(
			"/usr/bin/ditto",
			[join(mountPoint, "Google Chrome.app"), targetApp],
			90_000,
		);
	} finally {
		if (mounted) {
			try {
				await run("/usr/bin/hdiutil", ["detach", mountPoint], 30_000);
			} catch {
				// Installation verification below is authoritative; cleanup is best-effort.
			}
		}
		await rm(temporaryRoot, { recursive: true, force: true }).catch(
			() => undefined,
		);
	}
	const executable = join(targetApp, "Contents", "MacOS", "Google Chrome");
	const observation = await (options.verify ?? probeChromeRuntime)(executable);
	if (!observation.available) throw new Error("CHROME_INSTALL_VERIFY_FAILED");
	return observation;
}
