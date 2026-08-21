import { clearLine, cursorTo } from "node:readline";

import type {
	PlatformProgressEvent,
	PlatformProgressReporter,
} from "./progress.ts";

const colors = {
	green: "\u001b[32m",
	red: "\u001b[31m",
	yellow: "\u001b[33m",
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
		event.current && event.total ? `${event.current}/${event.total} · ` : "";
	const suffix =
		event.status === "SUCCEEDED"
			? "完成"
			: event.status === "ACTION_REQUIRED"
				? "待处理"
				: event.status === "FAILED"
					? "失败"
					: event.status === "SKIPPED"
						? "跳过"
						: "";
	const symbol =
		event.status === "STARTED"
			? spinner
			: event.status === "SUCCEEDED"
				? "✓"
				: event.status === "FAILED"
					? "✕"
					: event.status === "ACTION_REQUIRED"
						? "◆"
						: "○";
	if (!color)
		return `${symbol ? `${symbol} ` : ""}${prefix}${event.message}${suffix ? ` · ${suffix}` : ""}`;
	const tone =
		event.status === "SUCCEEDED"
			? colors.green
			: event.status === "FAILED"
				? colors.red
				: colors.yellow;
	return `${tone}${symbol}${colors.reset} ${colors.dim}${prefix}${colors.reset}${event.message}${suffix ? ` · ${tone}${suffix}${colors.reset}` : ""}`;
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
		clearSpinner();
		active = event.status === "STARTED" ? event : undefined;
		const line = progressLine(
			event,
			color,
			spinnerFrames[frame++ % spinnerFrames.length],
		);
		if (!interactive) {
			stream.write(`${line}\n`);
			return;
		}
		cursorTo(stream, 0);
		clearLine(stream, 0);
		stream.write(line);
		if (event.status === "STARTED") {
			timer = setInterval(paint, 80);
			timer.unref();
			return;
		}
		const compactModuleProgress =
			event.current !== undefined &&
			event.total !== undefined &&
			event.current < event.total &&
			event.status !== "FAILED" &&
			event.status !== "ACTION_REQUIRED";
		if (!compactModuleProgress) stream.write("\n");
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
