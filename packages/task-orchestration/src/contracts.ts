import { z } from "zod";

import { requiredTaskAgentPackageRefs } from "./model.ts";

export const publicOperationNames = [
	"createTaskGroup",
	"getTaskGroup",
	"startTaskGroup",
	"createTask",
	"listTasks",
	"getTask",
	"startTask",
	"pauseTask",
	"resumeTask",
	"terminateTask",
	"bindTaskWorker",
	"getTaskDriveProjection",
	"getNodeContext",
	"startNode",
	"completeNode",
	"waitNode",
	"failNode",
	"reopenNode",
	"putTaskDocument",
	"getTaskDocument",
	"listPendingMessages",
	"acknowledgeMessage",
	"listTaskEvents",
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
const roleBinding = z
	.object({
		agentPackageRef: id,
		roleRef: id,
		workerRef: id.nullable(),
		conversationLocator: id.nullable(),
	})
	.strict();
const planNode = z
	.object({
		nodeId: id,
		title: id,
		objective: id,
		requiredAgentPackageRef: id,
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
			initialDocuments: z
				.array(z.object({ documentType: id, content: z.string() }).strict())
				.optional()
				.default([]),
			roleBindings: z.array(roleBinding).min(3),
			...actor,
		})
		.strict()
		.superRefine((input, context) => {
			if (input.taskGroupId !== undefined && input.sequenceNo === undefined) {
				context.addIssue({
					code: "custom",
					message: "sequenceNo is required for a grouped Task",
					path: ["sequenceNo"],
				});
			}
			if (input.taskGroupId === undefined && input.sequenceNo !== undefined) {
				context.addIssue({
					code: "custom",
					message: "sequenceNo is only valid for a grouped Task",
					path: ["sequenceNo"],
				});
			}
			const declaredAgentPackageRefs = new Set(
				input.roleBindings.map((binding) => binding.agentPackageRef),
			);
			if (
				declaredAgentPackageRefs.size !== requiredTaskAgentPackageRefs.length ||
				requiredTaskAgentPackageRefs.some(
					(agentPackageRef) => !declaredAgentPackageRefs.has(agentPackageRef),
				)
			) {
				context.addIssue({
					code: "custom",
					message:
						"roleBindings must contain exactly Product, Controller/Dev, and Test/Ops",
					path: ["roleBindings"],
				});
			}
			input.plan.nodes.forEach((node, index) => {
				if (!declaredAgentPackageRefs.has(node.requiredAgentPackageRef))
					context.addIssue({
						code: "custom",
						message:
							"plan node requiredAgentPackageRef must resolve to a declared fixed TaskRoleBinding",
						path: ["plan", "nodes", index, "requiredAgentPackageRef"],
					});
			});
		}),
	getTaskDriveProjection: z.object({ taskId: id }).strict(),
	bindTaskWorker: z
		.object({
			taskId: id,
			agentPackageRef: id,
			roleRef: id,
			workerRef: id,
			conversationLocator: id,
			...taskVersion,
		})
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
		.object({ taskGroupId: id.optional(), statuses: z.array(id).optional() })
		.strict(),
	getTask: z.object({ taskId: id }).strict(),
	getNodeContext: z.object({ taskId: id, nodeId: id }).strict(),
	listPendingMessages: z.object({ taskId: id.optional() }).strict(),
	listTaskEvents: z
		.object({
			taskId: id,
			afterEventId: z.number().int().nonnegative().optional(),
			limit: z.number().int().positive().max(1000).optional(),
		})
		.strict(),
	putTaskDocument: z
		.object({
			taskId: id,
			nodeId: id.nullable(),
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
