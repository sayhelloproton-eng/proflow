export const PAGE_PERMISSION_WATCHDOG_INTERVAL_MS = 10_000;
export const PAGE_PERMISSION_BOTTOM_BUTTON_SCAN_LIMIT = 24;

function permissionMarker(label: string): "allow" | "deny" | null {
	const normalized = label.trim().toLocaleLowerCase();
	if (/始终允许|允许一次|^允许$|always allow|allow once|^allow$/.test(normalized))
		return "allow";
	if (/^拒绝$|^deny$/.test(normalized)) return "deny";
	return null;
}

export function hasBottomActionPermissionControls(
	buttonLabels: readonly string[],
): boolean {
	const markers = buttonLabels
		.slice(-PAGE_PERMISSION_BOTTOM_BUTTON_SCAN_LIMIT)
		.map(permissionMarker);
	return markers.includes("deny") && markers.includes("allow");
}
