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
		bindings?.find(
			(binding) =>
				binding.roleRef === input.roleRef &&
				binding.agentPackageRef === input.agentPackageRef,
		) ?? null;

	if (input.taskId !== undefined)
		return matchingRole(input.getRoleBindings(input.taskId));

	if (input.workerRef === null) return null;
	for (const taskId of input.listTaskIds()) {
		const binding = matchingRole(input.getRoleBindings(taskId));
		if (
			binding?.workerRef === input.workerRef &&
			binding.conversationLocator === input.conversationLocator
		)
			return binding;
	}
	return null;
}
