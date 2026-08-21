export type PlatformProgressStatus =
	| "STARTED"
	| "SUCCEEDED"
	| "ACTION_REQUIRED"
	| "FAILED"
	| "SKIPPED";

export interface PlatformProgressEvent {
	command: string;
	phase: string;
	current?: number;
	total?: number;
	moduleRef?: string;
	status: PlatformProgressStatus;
	message: string;
}

export type PlatformProgressReporter = (event: PlatformProgressEvent) => void;

export const reportProgress = (
	reporter: PlatformProgressReporter | undefined,
	event: PlatformProgressEvent,
) => reporter?.(event);
