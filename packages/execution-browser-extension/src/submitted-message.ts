export type SubmittedMessageCandidate = {
	authorRole: string | null;
	textContent: string | null;
};

export function containsSubmittedFingerprint(
	candidates: Iterable<SubmittedMessageCandidate>,
	fingerprint: string | undefined,
): boolean {
	if (!fingerprint) return false;
	for (const candidate of candidates) {
		if (
			candidate.authorRole === "user" &&
			candidate.textContent?.includes(fingerprint)
		)
			return true;
	}
	return false;
}
