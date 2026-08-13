import type {
	ExecuteCapabilityRequest,
	ExecutionRecord,
} from "@tomflow/proflow-execution-contracts";

export type BrowserTaskDriverTask = {
	taskId: string;
	status: string;
	version: number;
	currentNodeId: string | null;
	roleBindings: Array<{ roleRef: string; workerRef: string | null }>;
};

export type BrowserTaskDriverNodeContext = {
	task: { taskId: string; status: string; version: number };
	node: {
		nodeId: string;
		status: string;
		version: number;
		runNo: number;
		requiredRoleRef: string;
		workerRef: string | null;
	};
};

export interface BrowserTaskDriverOwnerPort {
	getTask(taskId: string): Promise<BrowserTaskDriverTask>;
	getNodeContext(
		taskId: string,
		nodeId: string,
	): Promise<BrowserTaskDriverNodeContext>;
	startTask(input: {
		taskId: string;
		expectedTaskVersion: number;
		idempotencyKey: string;
	}): Promise<unknown>;
	startNode(input: {
		taskId: string;
		nodeId: string;
		expectedTaskVersion: number;
		expectedNodeVersion: number;
		idempotencyKey: string;
	}): Promise<unknown>;
}

export interface BrowserTaskDriverIdentityPort {
	getRegisteredRole(roleRef: string): Promise<{ roleRef: string }>;
}

export interface BrowserTaskDriverExecutionPort {
	executeCapability(
		request: ExecuteCapabilityRequest,
	): Promise<ExecutionRecord>;
}

export type ProvisionPlan = {
	taskId: string;
	requests: Array<
		Extract<ExecuteCapabilityRequest, { capability: "worker.create" }>
	>;
};

export type NodeWakePlan = {
	taskId: string;
	nodeId: string;
	request: Extract<ExecuteCapabilityRequest, { capability: "worker.wake" }>;
};

export function createExecutionBrowserTaskDriver(options: {
	task: BrowserTaskDriverOwnerPort;
	identity: BrowserTaskDriverIdentityPort;
	execution: BrowserTaskDriverExecutionPort;
	roleUrl(roleRef: string): string;
}) {
	const internalCallerRef = "execution-runtime:task-driver";
	const assertRole = async (roleRef: string) => {
		const role = await options.identity.getRegisteredRole(roleRef);
		if (role.roleRef !== roleRef) throw new Error("ROLE_IDENTITY_MISMATCH");
	};
	const planProvision = async (taskId: string): Promise<ProvisionPlan> => {
		const task = await options.task.getTask(taskId);
		if (task.status !== "READY")
			throw new Error("TASK_NOT_AUTHORIZED_FOR_PROVISIONING");
		for (const binding of task.roleBindings) await assertRole(binding.roleRef);
		return {
			taskId,
			requests: task.roleBindings
				.filter((binding) => binding.workerRef === null)
				.map(
					(binding) =>
						({
							contract: "execution",
							contractVersion: "1.0.0",
							callerRef: internalCallerRef,
							taskId,
							idempotencyKey: `worker-create:${taskId}:${binding.roleRef}`,
							capability: "worker.create",
							input: {
								roleRef: binding.roleRef,
								roleUrl: options.roleUrl(binding.roleRef),
								bootstrapFingerprint: `bootstrap:${taskId}:${binding.roleRef}`,
							},
						}) satisfies Extract<
							ExecuteCapabilityRequest,
							{ capability: "worker.create" }
						>,
				),
		};
	};
	const applyProvision = async (input: {
		plan: ProvisionPlan;
		approvalRefs: Record<string, string>;
	}) => {
		const current = await planProvision(input.plan.taskId);
		const expected = JSON.stringify(input.plan.requests);
		if (JSON.stringify(current.requests) !== expected)
			throw new Error("PROVISION_PLAN_STALE");
		const records: ExecutionRecord[] = [];
		for (const request of current.requests) {
			const approvalRef = input.approvalRefs[request.input.roleRef];
			if (!approvalRef) throw new Error("EXECUTION_APPROVAL_REQUIRED");
			const record = await options.execution.executeCapability({
				...request,
				approvalRef,
			});
			records.push(record);
			if (
				record.status !== "SUCCEEDED" ||
				record.result?.capability !== "worker.create" ||
				record.result.data.verified !== true
			)
				break;
		}
		return records;
	};
	const startTask = async (taskId: string) => {
		const task = await options.task.getTask(taskId);
		if (task.status === "ACTIVE") return task;
		if (task.status !== "READY") throw new Error("TASK_NOT_READY");
		if (task.roleBindings.some((binding) => binding.workerRef === null))
			throw new Error("TASK_ROLE_BINDING_REQUIRED");
		return options.task.startTask({
			taskId,
			expectedTaskVersion: task.version,
			idempotencyKey: `task-driver:start:${taskId}`,
		});
	};
	const planNodeWake = async (taskId: string): Promise<NodeWakePlan> => {
		const task = await options.task.getTask(taskId);
		if (task.status !== "ACTIVE" || !task.currentNodeId)
			throw new Error("TASK_HAS_NO_ACTIVE_NODE");
		const context = await options.task.getNodeContext(
			taskId,
			task.currentNodeId,
		);
		if (
			context.node.status !== "READY" &&
			context.node.status !== "IN_PROGRESS"
		)
			throw new Error("NODE_NOT_WAKEABLE");
		const binding = task.roleBindings.find(
			(candidate) => candidate.roleRef === context.node.requiredRoleRef,
		);
		if (!binding?.workerRef) throw new Error("TASK_ROLE_BINDING_REQUIRED");
		await assertRole(context.node.requiredRoleRef);
		return {
			taskId,
			nodeId: context.node.nodeId,
			request: {
				contract: "execution",
				contractVersion: "1.0.0",
				callerRef: internalCallerRef,
				taskId,
				nodeId: context.node.nodeId,
				runNo: context.node.runNo,
				idempotencyKey: `worker-wake:${taskId}:${context.node.nodeId}:${context.node.runNo}`,
				capability: "worker.wake",
				input: {
					roleRef: context.node.requiredRoleRef,
					workerRef: binding.workerRef,
					trigger: `NODE_READY task=${taskId} node=${context.node.nodeId} run=${context.node.runNo}`,
					fingerprint: `wake:${taskId}:${context.node.nodeId}:${context.node.runNo}`,
				},
			},
		};
	};
	const applyNodeWake = async (input: {
		plan: NodeWakePlan;
		approvalRef: string;
	}) => {
		const current = await planNodeWake(input.plan.taskId);
		if (JSON.stringify(current) !== JSON.stringify(input.plan))
			throw new Error("NODE_WAKE_PLAN_STALE");
		const context = await options.task.getNodeContext(
			input.plan.taskId,
			input.plan.nodeId,
		);
		if (context.node.status === "READY")
			await options.task.startNode({
				taskId: input.plan.taskId,
				nodeId: input.plan.nodeId,
				expectedTaskVersion: context.task.version,
				expectedNodeVersion: context.node.version,
				idempotencyKey: `task-driver:start-node:${input.plan.taskId}:${input.plan.nodeId}:${context.node.runNo}`,
			});
		return options.execution.executeCapability({
			...current.request,
			approvalRef: input.approvalRef,
		});
	};
	return Object.freeze({
		planProvision,
		applyProvision,
		startTask,
		planNodeWake,
		applyNodeWake,
	});
}
