export function createObserverRecoveryRearm(recover: () => void) {
	let startupReady = false;
	let latestBridgeSessionEpoch = 0;

	const startupReadyAfterDenialRestore = () => {
		startupReady = true;
		recover();
	};

	const bridgeSessionEstablished = (epoch: number): boolean => {
		if (!Number.isInteger(epoch) || epoch <= 0)
			throw new TypeError("bridge session epoch must be a positive integer");
		if (epoch <= latestBridgeSessionEpoch) return false;
		latestBridgeSessionEpoch = epoch;
		if (!startupReady) return false;
		recover();
		return true;
	};

	return Object.freeze({
		startupReady: startupReadyAfterDenialRestore,
		bridgeSessionEstablished,
	});
}
