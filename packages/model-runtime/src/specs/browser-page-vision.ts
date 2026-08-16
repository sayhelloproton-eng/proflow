import {
	browserPageVisionInputSchema,
	browserPageVisionObservationSchema,
	createReasoningSpec,
} from "@tomflow/proflow-model-contracts";

export const browserPageVisionSpec = createReasoningSpec({
	id: "browser.page-vision",
	version: "1.0.0",
	purpose:
		"REASON-only semantic image judgment for one captured Browser page screenshot when deterministic DOM cannot explain the page; returns a spec-ized observation and never decides Task/Execution/Approval truth",
	allowedModes: ["reason"],
	requiredModalities: ["text", "image"],
	inputSchema: browserPageVisionInputSchema,
	outputSchema: browserPageVisionObservationSchema,
	instruction: [
		"Interpret the supplied captured Browser page screenshot together with the bounded deterministic observation context.",
		"Return a spec-ized page-state observation only; deterministic DOM and owner facts outrank this model output.",
		"Never decide Task completion, Execution success, or Approval, and never fabricate a page state.",
		"Return exactly one JSON object matching the required output schema.",
	].join(" "),
	maxContextBytes: 8_192,
	maxOutputTokens: 512,
	repair: "once",
	routing: {
		startRole: "reason",
		allowReasonEscalation: false,
		escalateDecisions: [],
	},
});
