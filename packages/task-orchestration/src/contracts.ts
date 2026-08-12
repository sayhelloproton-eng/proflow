import { z } from "zod";

export const publicOperationNames = [
	"createTaskGroup",
	"startTaskGroup",
	"createTask",
	"authorizeTask",
	"bindTaskWorker",
	"startTask",
	"pauseTask",
	"resumeTask",
	"terminateTask",
	"startNode",
	"completeNode",
	"waitNode",
	"failNode",
	"reopenNode",
	"acknowledgeMessage",
	"getTaskGroup",
	"listTasks",
	"getTask",
	"getNodeContext",
	"listPendingMessages",
	"listTaskEvents",
	"putTaskDocument",
	"getTaskDocument",
] as const;
export type PublicOperationName = (typeof publicOperationNames)[number];

const id = z.string().min(1);
const version = z.number().int().positive();
const actor = { actorRef: id, idempotencyKey: id };
const taskVersion = { expectedTaskVersion: version, ...actor };
const nodeVersion = {
	taskId: id,
	nodeId: id,
	expectedTaskVersion: version,
	expectedNodeVersion: version,
	...actor,
};
const planNode = z
	.object({
		nodeId: id.optional(),
		title: id,
		objective: id,
		requiredRoleRef: id,
		inputDocuments: z.array(id),
		outputDocuments: z.array(id),
	})
	.strict();

const schemas: Record<PublicOperationName, z.ZodType> = {
	createTaskGroup: z
		.object({
			taskGroupId: id.optional(),
			title: id,
			objective: z.string().optional(),
			maxActiveTasks: z.literal(1),
			...actor,
		})
		.strict(),
	startTaskGroup: z
		.object({ taskGroupId: id, expectedGroupVersion: version, ...actor })
		.strict(),
	createTask: z
		.object({
			taskId: id.optional(),
			taskGroupId: id.optional(),
			sequenceNo: version.optional(),
			title: id,
			objective: id,
			plan: z.object({ nodes: z.array(planNode).min(1) }).strict(),
			initialDocuments: z.array(
				z.object({ documentType: id, content: z.string() }).strict(),
			),
			roleBindings: z.array(
				z.object({ roleRef: id, workerRef: id.nullable() }).strict(),
			),
			...actor,
		})
		.strict(),
	authorizeTask: z.object({ taskId: id, ...taskVersion }).strict(),
	bindTaskWorker: z
		.object({ taskId: id, roleRef: id, workerRef: id, ...taskVersion })
		.strict(),
	startTask: z.object({ taskId: id, ...taskVersion }).strict(),
	pauseTask: z.object({ taskId: id, reason: id, ...taskVersion }).strict(),
	resumeTask: z.object({ taskId: id, ...taskVersion }).strict(),
	terminateTask: z.object({ taskId: id, reason: id, ...taskVersion }).strict(),
	startNode: z.object(nodeVersion).strict(),
	completeNode: z.object({ ...nodeVersion, resultSummary: id }).strict(),
	waitNode: z
		.object({
			...nodeVersion,
			waitType: id,
			reasonCode: id,
			message: id,
			relatedRef: id.optional(),
		})
		.strict(),
	failNode: z
		.object({
			...nodeVersion,
			errorCode: id,
			errorMessage: id,
			retryable: z.boolean(),
		})
		.strict(),
	reopenNode: z
		.object({ taskId: id, nodeId: id, reason: id, ...taskVersion })
		.strict(),
	acknowledgeMessage: z
		.object({ messageId: id, resolution: z.string().optional(), ...actor })
		.strict(),
	getTaskGroup: z.object({ taskGroupId: id }).strict(),
	listTasks: z
		.object({ taskGroupId: id.optional(), status: id.optional() })
		.strict(),
	getTask: z.object({ taskId: id }).strict(),
	getNodeContext: z.object({ taskId: id, nodeId: id }).strict(),
	listPendingMessages: z.object({ taskId: id.optional() }).strict(),
	listTaskEvents: z.object({ taskId: id }).strict(),
	putTaskDocument: z
		.object({
			taskId: id,
			nodeId: id,
			documentType: id,
			content: z.string(),
			targetPath: z.never().optional(),
			...taskVersion,
		})
		.strict(),
	getTaskDocument: z.object({ taskId: id, documentType: id }).strict(),
};

export function validatePublicInput(
	operation: PublicOperationName,
	input: unknown,
): unknown {
	return schemas[operation].parse(input);
}
