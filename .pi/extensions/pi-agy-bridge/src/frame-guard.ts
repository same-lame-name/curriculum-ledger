// Frame-guard: shared stdout framing defense.

export const MAX_FRAME_BYTES = 32 * 1024 * 1024;

const NOISE_MARKERS = ["Opening in existing browser session."];

export function isKnownNoiseLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed) return false;
	return NOISE_MARKERS.some((m) => trimmed === m);
}

export function stripGluedNoise(line: string): string | null {
	for (const marker of NOISE_MARKERS) {
		const idx = line.indexOf(marker);
		if (idx >= 0) return line.slice(idx + marker.length).trim();
	}
	return null;
}
