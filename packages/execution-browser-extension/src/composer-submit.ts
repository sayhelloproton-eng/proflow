export interface ComposerSubmitPort {
	readValue(): string;
	submitReady(): boolean;
	nextFrame(): Promise<void>;
	clickSubmit(): void;
}

export interface ControlledComposerPort extends ComposerSubmitPort {
	write(value: string): void;
	dispatchInput(value: string): void;
}

export async function submitAfterComposerCommit(
	port: ComposerSubmitPort,
	expectedValue: string,
	maxFrames = 180,
): Promise<void> {
	let stableFrames = 0;
	for (let frame = 0; frame < maxFrames; frame += 1) {
		await port.nextFrame();
		if (port.readValue() === expectedValue && port.submitReady()) {
			stableFrames += 1;
			if (stableFrames >= 2) {
				port.clickSubmit();
				return;
			}
		} else {
			stableFrames = 0;
		}
	}
	throw new Error("COMPOSER_SUBMIT_NOT_READY");
}

export async function submitControlledComposer(
	port: ControlledComposerPort,
	expectedValue: string,
	maxFrames = 180,
): Promise<void> {
	port.write(expectedValue);
	port.dispatchInput(expectedValue);
	await submitAfterComposerCommit(port, expectedValue, maxFrames);
}
