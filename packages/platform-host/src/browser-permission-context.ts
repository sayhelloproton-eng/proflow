export type BrowserPermissionTaskBinding = {
	agentPackageRef: string;
	roleRef: string;
	workerRef: string | null;
	conversationLocator: string | null;
};

export function resolveBrowserPermissionTaskBinding(input: {
	taskId?: string;
	agentPackageRef: string;
	roleRef: string;
	workerRef: string | null;
	conversationLocator: string;
	listTaskIds(): readonly string[];
	getRoleBindings(taskId: string): readonly BrowserPermissionTaskBinding[] | null;
}): BrowserPermissionTaskBinding | null {
	const matchingRole = (
		bindings: readonly BrowserPermissionTaskBinding[] | null,
	): BrowserPermissionTaskBinding | null =>
		unique(
			bindings?.filter(
				(binding) =>
					binding.roleRef === input.roleRef &&
					binding.agentPackageRef === input.agentPackageRef,
			) ?? [],
		);

	if (input.taskId !== undefined)
		return matchingRole(input.getRoleBindings(input.taskId));

	if (input.workerRef === null) return null;
	let match: BrowserPermissionTaskBinding | null = null;
	for (const taskId of input.listTaskIds()) {
		const bindings = input.getRoleBindings(taskId);
		// An incomplete scan cannot establish an unambiguous durable identity.
		if (bindings === null) return null;
		for (const binding of bindings) {
			if (
				binding.conversationLocator !== input.conversationLocator &&
				!(binding.roleRef === input.roleRef && binding.workerRef === input.workerRef)
			)
				continue;
			if (
				match !== null ||
				binding.agentPackageRef !== input.agentPackageRef ||
				binding.roleRef !== input.roleRef ||
				binding.workerRef !== input.workerRef ||
				binding.conversationLocator !== input.conversationLocator
			)
				return null;
			match = binding;
		}
	}
	return match;
}

function unique(
	bindings: readonly BrowserPermissionTaskBinding[],
): BrowserPermissionTaskBinding | null {
	return bindings.length === 1 ? bindings[0] ?? null : null;
}
