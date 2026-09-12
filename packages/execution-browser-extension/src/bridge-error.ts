export class BrowserRealityBridgeError extends Error {
	readonly code:
		| "BRIDGE_AUTH_INVALID"
		| "BRIDGE_INPUT_INVALID"
		| "BRIDGE_OFFLINE"
		| "BRIDGE_COMMAND_TIMEOUT"
		| "BRIDGE_COMMAND_FAILED";

	constructor(code: BrowserRealityBridgeError["code"], message: string) {
		super(message);
		this.name = "BrowserRealityBridgeError";
		this.code = code;
	}
}
