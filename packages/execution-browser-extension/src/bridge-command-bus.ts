import { BrowserRealityBridgeError } from "./bridge-error.ts";
import { isRecord, stringField } from "./bridge-http.ts";
import type { BridgeCommand, BridgeCommandInput } from "./bridge-protocol.ts";

type PendingCommand = {
	command: BridgeCommand;
	stage: "QUEUED" | "DELIVERED";
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
};

export function createBridgeCommandBus(options: {
	now(): Date;
	idFactory(): string;
	freshnessMs: number;
	commandTimeoutMs: number;
}) {
	const queue: BridgeCommand[] = [];
	const pending = new Map<string, PendingCommand>();
	let session:
		| {
				extensionInstanceId: string;
				moduleVersion: string;
				lastHeartbeatAt: number;
		  }
		| undefined;
	let lastCommandPollAt: string | null = null;
	let lastCommandDeliveredAt: string | null = null;
	let lastCommandResultAt: string | null = null;
	let lastCommandConsumerAt: number | null = null;
	let closed = false;

	const sessionOnline = () =>
		!closed &&
		session !== undefined &&
		options.now().getTime() - session.lastHeartbeatAt <= options.freshnessMs;
	const commandConsumerReady = () =>
		sessionOnline() &&
		lastCommandConsumerAt !== null &&
		options.now().getTime() - lastCommandConsumerAt <= options.freshnessMs;

	const assertInstance = (extensionInstanceId: string | null): void => {
		if (!session)
			throw new BrowserRealityBridgeError(
				"BRIDGE_OFFLINE",
				"extension session has not completed hello",
			);
		if (extensionInstanceId !== session.extensionInstanceId)
			throw new BrowserRealityBridgeError(
				"BRIDGE_AUTH_INVALID",
				"stale extension session",
			);
	};

	const status = () => ({
		online: commandConsumerReady(),
		sessionOnline: sessionOnline(),
		commandConsumerReady: commandConsumerReady(),
		extensionInstanceId: session?.extensionInstanceId ?? null,
		queuedCommands: queue.length,
		pendingCommands: pending.size,
		lastCommandPollAt,
		lastCommandDeliveredAt,
		lastCommandResultAt,
	});

	return Object.freeze({
		status,
		sessionInfo: () =>
			session
				? {
						extensionInstanceId: session.extensionInstanceId,
						moduleVersion: session.moduleVersion,
					}
				: null,
		online: commandConsumerReady,
		assertInstance,
		hello(extensionInstanceId: string, moduleVersion: string): void {
			if (
				session?.extensionInstanceId !== extensionInstanceId ||
				session?.moduleVersion !== moduleVersion
			) {
				lastCommandPollAt = null;
				lastCommandDeliveredAt = null;
				lastCommandResultAt = null;
				lastCommandConsumerAt = null;
			}
			session = {
				extensionInstanceId,
				moduleVersion,
				lastHeartbeatAt: options.now().getTime(),
			};
		},
		heartbeat(extensionInstanceId: string | null): void {
			assertInstance(extensionInstanceId);
			if (session) session.lastHeartbeatAt = options.now().getTime();
		},
		poll(extensionInstanceId: string | null): BridgeCommand | null {
			assertInstance(extensionInstanceId);
			const stamp = options.now();
			if (session) session.lastHeartbeatAt = stamp.getTime();
			lastCommandConsumerAt = stamp.getTime();
			lastCommandPollAt = stamp.toISOString();
			const command = queue.shift() ?? null;
			if (command) {
				const tracked = pending.get(command.commandId);
				if (tracked) tracked.stage = "DELIVERED";
				lastCommandDeliveredAt = lastCommandPollAt;
			}
			return command;
		},
		settle(extensionInstanceId: string | null, value: unknown): void {
			assertInstance(extensionInstanceId);
			if (!isRecord(value))
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"command result must be an object",
				);
			const commandId = stringField(value, "commandId");
			const command = pending.get(commandId);
			if (!command)
				throw new BrowserRealityBridgeError(
					"BRIDGE_INPUT_INVALID",
					"command result is stale or unknown",
				);
			pending.delete(commandId);
			clearTimeout(command.timer);
			const stamp = options.now();
			if (session) session.lastHeartbeatAt = stamp.getTime();
			lastCommandConsumerAt = stamp.getTime();
			lastCommandResultAt = stamp.toISOString();
			if (value.ok === true) command.resolve(value.value);
			else
				command.reject(
					new BrowserRealityBridgeError(
						"BRIDGE_COMMAND_FAILED",
						typeof value.error === "string"
							? value.error
							: "extension command failed",
					),
				);
		},
		request(command: BridgeCommandInput): Promise<unknown> {
			if (!commandConsumerReady())
				return Promise.reject(
					new BrowserRealityBridgeError(
						"BRIDGE_OFFLINE",
						"extension command consumer is not ready",
					),
				);
			const commandId = `browser-command:${options.idFactory()}`;
			return new Promise<unknown>((resolve, reject) => {
				const timer = setTimeout(() => {
					const tracked = pending.get(commandId);
					if (tracked?.stage === "QUEUED") {
						const index = queue.findIndex(
							(item) => item.commandId === commandId,
						);
						if (index >= 0) queue.splice(index, 1);
					}
					pending.delete(commandId);
					reject(
						new BrowserRealityBridgeError(
							"BRIDGE_COMMAND_TIMEOUT",
							"extension command result timed out",
						),
					);
				}, options.commandTimeoutMs);
				const materialized = { ...command, commandId } as BridgeCommand;
				pending.set(commandId, {
					command: materialized,
					stage: "QUEUED",
					resolve,
					reject,
					timer,
				});
				queue.push(materialized);
			});
		},
		close(): void {
			closed = true;
			for (const item of pending.values()) {
				clearTimeout(item.timer);
				item.reject(
					new BrowserRealityBridgeError(
						"BRIDGE_OFFLINE",
						"bridge server closed",
					),
				);
			}
			pending.clear();
			queue.length = 0;
		},
	});
}

export type BridgeCommandBus = ReturnType<typeof createBridgeCommandBus>;
