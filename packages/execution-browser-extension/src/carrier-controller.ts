/**
 * Browser Carrier Controller.
 *
 * The Background Service Worker is the only Carrier Controller. It performs
 * physical page create/restore/wake and delivery, and never mutates Node
 * business state. A New Task is first created in PENDING status; the Carrier
 * restores the existing Conversation by its stable conversationLocator and
 * submits a minimal trigger, claiming physical delivery only.
 */

export type CarrierWakeRequest = {
	taskId: string;
	nodeId: string;
	runNo: number;
	workerRef: string;
	trigger: string;
	conversationLocator: string;
};

export interface CarrierControllerPort {
	submitWake(request: CarrierWakeRequest): Promise<{ delivered: boolean }>;
}

export function createCarrierController(options: {
	port: CarrierControllerPort;
}) {
	const wake = async (request: CarrierWakeRequest) => {
		return options.port.submitWake(request);
	};

	return Object.freeze({ wake });
}
