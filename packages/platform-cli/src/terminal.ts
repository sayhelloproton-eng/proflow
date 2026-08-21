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

function progressLine(event: PlatformProgressEvent, color: boolean): string {
	const prefix =
		event.current && event.total
			? `[${String(event.current).padStart(2, "0")}/${event.total}] `
			: "";
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
	if (!color || suffix === "")
		return `${prefix}${event.message}${suffix ? `… ${suffix}` : "…"}`;
	const tone =
		event.status === "SUCCEEDED"
			? colors.green
			: event.status === "FAILED"
				? colors.red
				: colors.yellow;
	return `${colors.dim}${prefix}${colors.reset}${event.message}… ${tone}${suffix}${colors.reset}`;
}

export function createTerminalProgressReporter(
	stream: NodeJS.WriteStream = process.stderr,
): PlatformProgressReporter {
	const interactive = stream.isTTY === true;
	const color = interactive && !("NO_COLOR" in process.env);
	return (event) => {
		const line = progressLine(event, color);
		if (!interactive) {
			stream.write(`${line}\n`);
			return;
		}
		cursorTo(stream, 0);
		clearLine(stream, 0);
		stream.write(line);
		if (event.status !== "STARTED") stream.write("\n");
	};
}
