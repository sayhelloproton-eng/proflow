import type { PageRealityController } from "./page-reality-controller.js";
import type { ExtensionLogger } from "./extension-logger.js";

type PermissionActionPagePort = Pick<
	PageRealityController,
	"current" | "sessions" | "waitForPermissionReleased" | "contentCommand"
>;

export function createPermissionActionLoggingPage(options: {
	page: PermissionActionPagePort;
	logger: Pick<ExtensionLogger, "emit">;
	now?: () => number;
}) {
	const now = options.now ?? (() => performance.now());

	return Object.freeze({
		current: options.page.current,
		sessions: options.page.sessions,
		waitForPermissionReleased: options.page.waitForPermissionReleased,
		async contentCommand(
			tabId: number,
			command: Parameters<PermissionActionPagePort["contentCommand"]>[1],
		): Promise<unknown> {
			if (command.operation !== "permissionAction")
				return options.page.contentCommand(tabId, command);

			const observed = options.page.current(tabId);
			const started = now();
			try {
				const value = await options.page.contentCommand(tabId, command);
				await options.logger.emit({
					component: "permission-action-boundary",
					event: "PERMISSION_ACTION",
					phase: "DISPATCHED",
					status: "SUCCEEDED",
					operationId: "permissionAction",
					...(command.permissionFingerprint
						? {
								operationRef: command.permissionFingerprint,
								correlationId: `permission:${command.permissionFingerprint}`,
								correlationKind: "IDENTITY_MATCH" as const,
							}
						: {}),
					...(command.permissionAction
						? { action: command.permissionAction }
						: {}),
					sideEffectState: "STARTED",
					tabId,
					contentInstanceId: observed.contentInstanceId,
					conversationLocator: observed.url,
					durationMs: now() - started,
				});
				return value;
			} catch (error) {
				await options.logger.emit({
					component: "permission-action-boundary",
					event: "PERMISSION_ACTION",
					phase: "DISPATCHED",
					status: "FAILED",
					operationId: "permissionAction",
					...(command.permissionFingerprint
						? {
								operationRef: command.permissionFingerprint,
								correlationId: `permission:${command.permissionFingerprint}`,
								correlationKind: "IDENTITY_MATCH" as const,
							}
						: {}),
					...(command.permissionAction
						? { action: command.permissionAction }
						: {}),
					errorCode: "PERMISSION_ACTION_FAILED",
					sideEffectState: "UNKNOWN",
					tabId,
					contentInstanceId: observed.contentInstanceId,
					conversationLocator: observed.url,
					durationMs: now() - started,
				});
				throw error;
			}
		},
	});
}
