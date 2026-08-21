export type PlatformProgressStatus =
	| "STARTED"
	| "SUCCEEDED"
	| "WARNING"
	| "ACTION_REQUIRED"
	| "FAILED"
	| "SKIPPED";

export type PlatformProgressKind = "phase" | "detail" | "subprocess";
export type PlatformProgressRetention = "KEEP" | "REPLACE";

export interface PlatformProgressEvent {
	command: string;
	phase: string;
	kind?: PlatformProgressKind;
	retention?: PlatformProgressRetention;
	current?: number;
	total?: number;
	moduleRef?: string;
	elapsedMs?: number;
	status: PlatformProgressStatus;
	message: string;
}

export type PlatformProgressReporter = (event: PlatformProgressEvent) => void;

export const reportProgress = (
	reporter: PlatformProgressReporter | undefined,
	event: PlatformProgressEvent,
) => reporter?.(event);
