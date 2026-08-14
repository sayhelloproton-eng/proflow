import { descriptor } from "../deployment/descriptor.ts";

export { descriptor };

export const moduleRef = descriptor.moduleRef;
export const packageName = descriptor.packageName;
export const moduleVersion = descriptor.moduleVersion;
export const kind = descriptor.kind;

export const FROZEN_FACT_CATEGORIES = [
	"moduleRef",
	"packageName",
	"moduleVersion",
	"kind",
	"provides",
	"requires",
	"requirements",
	"configSlots",
	"lifecycle",
	"verification",
	"effects",
	"Frozen TODO",
	"Frozen Test Plan",
	"Frozen Contract",
] as const;

export const STOP_RULE_TOKENS = [
	"PENDING_DECISION",
	"NOT_FROZEN",
	"ACCEPTANCE_NOT_FROZEN",
	"SPEC_GAP",
	"PENDING_SPIKE",
	"STOP",
] as const;
