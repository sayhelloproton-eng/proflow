import { clearLine, cursorTo } from "node:readline";

import type {
	PlatformProgressEvent,
	PlatformProgressReporter,
} from "./progress.ts";

const colors = {
	cyan: "\u001b[36m",
	blue: "\u001b[34m",
	green: "\u001b[32m",
	red: "\u001b[31m",
	yellow: "\u001b[33m",
	bold: "\u001b[1m",
	dim: "\u001b[2m",
	reset: "\u001b[0m",
} as const;

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function progressLine(
	event: PlatformProgressEvent,
	color: boolean,
	spinner = "",
): string {
	const prefix =
		event.current && event.total
			? `[${String(event.current).padStart(String(event.total).length, "0")}/${event.total}] `
			: "";
	const elapsed =
		event.elapsedMs !== undefined
			? ` · ${(event.elapsedMs / 1000).toFixed(1)}s`
			: "";
	const suffix =
		event.status === "SUCCEEDED"
			? "完成"
			: event.status === "WARNING"
				? "警告"
				: event.status === "ACTION_REQUIRED"
					? "待处理"
					: event.status === "FAILED"
						? "失败"
						: event.status === "SKIPPED"
							? "跳过"
							: "";
	const symbol =
		event.kind === "subprocess"
			? "│"
			: event.status === "STARTED"
				? spinner
				: event.status === "SUCCEEDED"
					? "✓"
					: event.status === "WARNING"
						? "!"
						: event.status === "FAILED"
							? "✕"
							: event.status === "ACTION_REQUIRED"
								? "◆"
								: "○";
	if (!color)
		return `${symbol ? `${symbol} ` : ""}${prefix}${event.message}${suffix ? ` · ${suffix}` : ""}${elapsed}`;
	const tone =
		event.status === "SUCCEEDED"
			? colors.green
			: event.status === "WARNING"
				? colors.yellow
				: event.status === "FAILED"
					? colors.red
					: event.kind === "subprocess"
						? colors.blue
						: colors.yellow;
	return `${tone}${symbol}${colors.reset} ${colors.dim}${prefix}${colors.reset}${event.message}${suffix ? ` · ${tone}${suffix}${colors.reset}` : ""}${event.elapsedMs === undefined ? "" : `${colors.dim}${elapsed}${colors.reset}`}`;
}

export type TerminalProgressReporter = PlatformProgressReporter & {
	close(): void;
};

export function createTerminalProgressReporter(
	stream: NodeJS.WriteStream = process.stderr,
): TerminalProgressReporter {
	const interactive = stream.isTTY === true;
	const color =
		interactive &&
		process.env.NO_COLOR === undefined &&
		process.env.TERM !== "dumb";
	let timer: NodeJS.Timeout | undefined;
	let frame = 0;
	let active: PlatformProgressEvent | undefined;
	const clearSpinner = () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	};
	const paint = () => {
		if (!active) return;
		cursorTo(stream, 0);
		clearLine(stream, 0);
		stream.write(
			progressLine(
				active,
				color,
				spinnerFrames[frame++ % spinnerFrames.length],
			),
		);
	};
	const reporter = ((event: PlatformProgressEvent) => {
		// Default terminal output is intentionally compact. Registry package-by-package
		// verification and setup module traversal remain available to programmatic
		// progress consumers, but are not useful as ordinary human-facing output.
		if (
			(event.command === "install" &&
				event.phase === "registry" &&
				event.kind === "detail") ||
			(event.command === "setup" &&
				event.moduleRef !== undefined &&
				event.current !== undefined &&
				event.total !== undefined)
		)
			return;
		clearSpinner();
		const previousActive = active;
		if (event.kind !== "subprocess") {
			active = event.status === "STARTED" ? event : undefined;
		}
		const line = progressLine(
			event,
			color,
			interactive ? spinnerFrames[frame++ % spinnerFrames.length] : "›",
		);
		if (!interactive) {
			stream.write(`${line}\n`);
			return;
		}
		if (event.retention === "REPLACE" && event.status !== "STARTED") {
			cursorTo(stream, 0);
			clearLine(stream, 0);
			active = undefined;
			return;
		}
		cursorTo(stream, 0);
		clearLine(stream, 0);
		stream.write(line);
		if (event.kind === "subprocess") {
			stream.write("\n");
			active = previousActive;
			if (active) {
				paint();
				timer = setInterval(paint, 80);
				timer.unref();
			}
			return;
		}
		if (event.status === "STARTED") {
			timer = setInterval(paint, 80);
			timer.unref();
			return;
		}
		stream.write("\n");
	}) as TerminalProgressReporter;
	reporter.close = () => {
		clearSpinner();
		if (interactive && active) {
			cursorTo(stream, 0);
			clearLine(stream, 0);
		}
		active = undefined;
	};
	return reporter;
}
