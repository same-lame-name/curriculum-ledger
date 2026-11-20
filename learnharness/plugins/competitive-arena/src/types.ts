import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export const COMPETITIVE_ARENA_PLUGIN_ID = "competitive-arena";
export const DEFAULT_TTL_DAYS = 7;
export const POINTER_FILENAME = ".pi-arena-root";

export const CANONICAL_DOMAINS = [
	"Dynamic Programming",
	"Data Structures",
	"Math",
	"Graphs",
	"Strings",
	"Geometry",
	"Implementation",
	"Algorithmic Techniques (except DP)",
] as const;

export type CanonicalDomain = (typeof CANONICAL_DOMAINS)[number];

export interface ModelRef {
	provider: string;
	id: string;
}

export interface ArenaPluginSettings {
	pointerEnabled: boolean;
	practiceDir: string;
	launchCommand: string;
	autoLaunch: boolean;
	artifactTtlDays: number;
	workerModelOverride: ModelRef | null;
	workerThinkingOverride: ThinkingLevel | null;
}

export type ArenaPluginSettingsPatch = Partial<{
	pointerEnabled: unknown;
	practiceDir: unknown;
	launchCommand: unknown;
	autoLaunch: unknown;
	artifactTtlDays: unknown;
	workerModelOverride: unknown;
	workerThinkingOverride: unknown;
}>;

export interface EnvironmentItem {
	id: string;
	label: string;
	ok: boolean;
	required: boolean;
	detail: string;
}

export interface EnvironmentCheck {
	ready: boolean;
	checkedAt: string;
	arenaDir: string;
	pointerPath: string;
	items: EnvironmentItem[];
}

export interface LiveProblemStatus {
	id: string;
	state: string;
	verdict?: string;
	wrongAttempts: number;
	hintsUsed: number;
	samplesPassed?: number;
	samplesTotal?: number;
	judge?: string;
	approach?: string;
}

export interface ActiveArenaSnapshot {
	sessionId: string;
	title: string;
	purpose: string;
	gradingPolicy: string;
	timerMode: string;
	totalTimeBudgetSeconds: number;
	createdAt: string;
	startedAtMs: number;
	attached: boolean;
	activeProblemId: string | null;
	lastEventText: string;
	problems: {
		id: string;
		title: string;
		url: string;
		difficulty?: number;
		domain?: string;
		hasTests: boolean;
		live: LiveProblemStatus;
	}[];
}

export interface ArenaResultProblem {
	id: string;
	catalog_id: string;
	title: string;
	url: string;
	platform: string;
	difficulty: number | null;
	domain: string | null;
	verdict: string;
	pending_verdict: boolean;
	duration_seconds: number;
	thinking_seconds: number | null;
	budget_seconds: number;
	overtime_seconds: number;
	solved_at_seconds: number;
	wrong_attempts: number;
	hints_used: number;
	rated: boolean;
	rating_before: number;
	rating_after: number;
	rating_delta: number;
	approach: string;
	reflection: string;
	final_code: string;
	local_judge: {
		verdict?: string;
		passed?: number;
		total?: number;
		failedCase?: string;
	} | null;
	attempt_diffs: {
		from: string;
		to: string;
		diff: string;
	}[];
	attempts: {
		attempt?: number;
		verdict?: string;
		elapsedSeconds?: number;
		elapsed_seconds?: number;
	}[];
}

export interface ArenaResultPayload {
	session_id: string;
	title: string;
	course_slug?: string | null;
	purpose: string;
	grading_policy: string;
	timer_mode: string;
	status: string;
	rating_before: number;
	rating_after: number;
	rating_delta: number;
	tier: string;
	problems: ArenaResultProblem[];
}

export interface RatingSeriesPoint {
	idx: number;
	problemId: string;
	title: string;
	difficulty: number | null;
	verdict: string;
	rated: boolean;
	ratingBefore: number;
	ratingAfter: number;
	ratingDelta: number;
	timestamp?: string;
}

export interface ArenaDashboardState {
	revision: number;
	dataDirectory: string;
	arenaDir: string;
	settings: ArenaPluginSettings;
	environment: EnvironmentCheck;
	standing: any | null;
	standingError: string | null;
	ratingSeries: RatingSeriesPoint[];
	ladder: any | null;
	ladderRounds: any[];
	ladderStats: any | null;
	ladderError: string | null;
	active: ActiveArenaSnapshot | null;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
