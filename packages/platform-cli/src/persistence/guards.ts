import { PlatformError } from "../errors.ts";

const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertSafeFileName(name: string, kind: string): void {
	if (!SAFE_FILE_NAME.test(name)) {
		throw new PlatformError("INVALID_REQUEST", `invalid ${kind} name: ${name}`);
	}
}
