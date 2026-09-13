export type PageRealityPermissionCorrelation = {
	operationRef?: string;
	correlationId?: string;
	correlationKind?: "IDENTITY_MATCH";
	operationId?: string;
};

type PermissionFacts = {
	fingerprint: string;
	operationId: string;
};

type PageRealityObservation = {
	tabId: number;
	contentInstanceId: string;
	url: string;
	activityKind: string | null;
	blockerFacts?: PermissionFacts;
};

function permissionAxes(facts: PermissionFacts): PageRealityPermissionCorrelation {
	return {
		operationRef: facts.fingerprint,
		correlationId: `permission:${facts.fingerprint}`,
		correlationKind: "IDENTITY_MATCH",
		operationId: facts.operationId,
	};
}

export function pageRealityPermissionCorrelation(
	previous: PageRealityObservation | undefined,
	observed: PageRealityObservation,
): PageRealityPermissionCorrelation {
	if (observed.activityKind === "ACTION_PERMISSION" && observed.blockerFacts)
		return permissionAxes(observed.blockerFacts);
	if (
		previous?.activityKind !== "ACTION_PERMISSION" ||
		!previous.blockerFacts ||
		previous.tabId !== observed.tabId ||
		previous.contentInstanceId !== observed.contentInstanceId ||
		previous.url !== observed.url
	)
		return {};
	return permissionAxes(previous.blockerFacts);
}
