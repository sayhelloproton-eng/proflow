export type CarrierPermissionAttemptSnapshot = ReadonlyArray<{
	tabId: number;
	key: string;
}>;

function parsedAttempts(value: unknown): {
	attempts: Map<number, string>;
	valid: boolean;
} {
	const result = new Map<number, string>();
	if (value === undefined) return { attempts: result, valid: true };
	if (!Array.isArray(value)) return { attempts: result, valid: false };
	let valid = value.length <= 256;
	for (const candidate of value.slice(0, 256)) {
		if (
			typeof candidate !== "object" ||
			candidate === null ||
			Array.isArray(candidate)
		) {
			valid = false;
			continue;
		}
		const tabId = Reflect.get(candidate, "tabId");
		const key = Reflect.get(candidate, "key");
		if (
			!Number.isInteger(tabId) ||
			(tabId as number) < 0 ||
			typeof key !== "string" ||
			key.length === 0 ||
			key.length > 1_000
		) {
			valid = false;
			continue;
		}
		if (result.has(tabId as number)) valid = false;
		result.set(tabId as number, key);
	}
	return { attempts: result, valid };
}

/**
 * Tracks only automatic actions whose post-click reality is not yet known.
 * A confirmed release removes the entry, so a later identical permission is a
 * new occurrence; an MV3 service-worker restart reloads the bounded snapshot
 * and therefore cannot blindly repeat an uncertain click.
 */
export function createCarrierPermissionAttemptRegistry(initial?: unknown) {
	const attempts = parsedAttempts(initial).attempts;
	return Object.freeze({
		has(tabId: number, key: string): boolean {
			return attempts.get(tabId) === key;
		},
		begin(tabId: number, key: string): void {
			attempts.set(tabId, key);
		},
		release(tabId: number, key: string): boolean {
			if (attempts.get(tabId) !== key) return false;
			return attempts.delete(tabId);
		},
		observe(tabId: number, currentKey: string | null): boolean {
			const attempted = attempts.get(tabId);
			if (attempted === undefined || attempted === currentKey) return false;
			return attempts.delete(tabId);
		},
		load(value: unknown): boolean {
			const parsed = parsedAttempts(value);
			attempts.clear();
			for (const [tabId, key] of parsed.attempts) attempts.set(tabId, key);
			return parsed.valid;
		},
		snapshot(): CarrierPermissionAttemptSnapshot {
			return [...attempts].map(([tabId, key]) => ({ tabId, key }));
		},
	});
}
