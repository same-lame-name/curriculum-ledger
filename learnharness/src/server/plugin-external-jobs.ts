import { createHash } from "node:crypto";
import {
	chainsForSelection,
	formatChainLine,
	newGraphContextMessage,
	titleFromPrompt,
	type GraphContextPick,
} from "../core/index.ts";
import { buildSubagentSteer, type SteerMessage } from "../core/contracts/jobs.ts";
import type { ChatStore, GraphStore, JobStore } from "../core/ports.ts";
import type { UserSettings } from "../core/settings.ts";
import type {
	PluginExternalJobHandle,
	PluginExternalJobInit,
	PluginExternalJobResult,
	PluginTeachingSessionHandle,
	PluginTeachingSessionInit,
} from "../core/plugins.ts";
import type { PluginBackgroundResult, PluginTaskOutcome } from "../core/plugin-workers.ts";
import { presentationData } from "./plugin-background-tools.ts";

const NATIVE_TOOL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export interface ExternalJobServiceDeps {
	pluginId: string;
	chatStore: ChatStore;
	jobStore: JobStore;
	deliver: (steer: SteerMessage) => Promise<void>;
	isActive: () => boolean;
}

export interface TeachingSessionServiceDeps {
	chatStore: ChatStore;
	graphStore: GraphStore;
	readSettings: () => UserSettings | null;
	isActive: () => boolean;
}

function assertActive(isActive: () => boolean): void {
	if (!isActive()) throw new Error("Plugin activation is no longer active");
}

function normalizeOptionalJson(value: unknown, label: string): unknown {
	if (value === undefined) return undefined;
	try {
		return presentationData(value);
	} catch {
		throw new Error(`${label} must be finite, acyclic JSON`);
	}
}

export function createPluginExternalJob(
	deps: ExternalJobServiceDeps,
	init: PluginExternalJobInit,
): PluginExternalJobHandle {
	assertActive(deps.isActive);
	const chatId = typeof init?.chatId === "string" ? init.chatId.trim() : "";
	const toolCallId = typeof init?.toolCallId === "string" ? init.toolCallId.trim() : "";
	const toolName = typeof init?.toolName === "string" ? init.toolName.trim() : "";
	if (!chatId) throw new Error("createExternalJob requires a non-empty chatId");
	if (!toolCallId) throw new Error("createExternalJob requires a non-empty toolCallId");
	if (!NATIVE_TOOL_NAME_RE.test(toolName)) {
		throw new Error("createExternalJob requires a valid toolName (letter/underscore first, max 64 chars)");
	}
	if (!deps.chatStore.getChat(chatId)) {
		throw new Error(`Chat not found: ${chatId}`);
	}
	const input = normalizeOptionalJson(init.input, "External job input");
	const known = deps.jobStore.findJobByToolCallId(chatId, toolCallId);
	if (known) {
		if (known.kind !== "plugin" || known.plugin?.pluginId !== deps.pluginId || known.plugin?.external !== true) {
			throw new Error(`Tool call ${toolCallId} is already bound to a different job`);
		}
		return {
			jobId: known.id,
			chatId: known.chatId,
			toolCallId: known.toolCallId,
			ackDetails: { jobId: known.id, dispatched: true },
		};
	}

	const requestId = `external_${createHash("sha256").update(JSON.stringify([deps.pluginId, chatId, toolCallId])).digest("hex")}`;
	const taskId = `ext_${toolCallId}`;
	const label = typeof init.label === "string" && init.label.trim() ? init.label.trim() : toolName;
	const activity = typeof init.activity === "string" && init.activity.trim() ? init.activity.trim() : "waiting";

	const job = deps.jobStore.createJob({
		kind: "plugin",
		chatId,
		toolCallId,
		input,
		activity,
		plugin: {
			pluginId: deps.pluginId,
			toolName,
			workerId: "external",
			requestId,
			taskId,
			input,
			label,
			external: true,
		},
	});

	return {
		jobId: job.id,
		chatId: job.chatId,
		toolCallId: job.toolCallId,
		ackDetails: { jobId: job.id, dispatched: true },
	};
}

export async function deliverPluginExternalJobResult(
	deps: ExternalJobServiceDeps,
	jobId: string,
	result: PluginExternalJobResult,
): Promise<void> {
	assertActive(deps.isActive);
	const cleanJobId = typeof jobId === "string" ? jobId.trim() : "";
	if (!cleanJobId) throw new Error("deliverExternalJobResult requires a jobId");
	if (result?.status !== "succeeded" && result?.status !== "failed") {
		throw new Error("deliverExternalJobResult requires status 'succeeded' or 'failed'");
	}
	if (typeof result.text !== "string" || !result.text.trim()) {
		throw new Error("deliverExternalJobResult requires nonempty text");
	}
	const data = normalizeOptionalJson(result.data, "External job result data");

	const job = deps.jobStore.getJob(cleanJobId);
	if (!job || job.kind !== "plugin" || job.plugin?.pluginId !== deps.pluginId || job.plugin?.external !== true) {
		throw new Error(`External job not found for plugin ${deps.pluginId}: ${cleanJobId}`);
	}
	if (job.delivery?.status === "delivered" || job.delivery?.kind === "abort") {
		return;
	}

	const taskId = job.plugin.taskId ?? `ext_${job.toolCallId}`;
	const outcome: PluginTaskOutcome =
		result.status === "succeeded"
			? { id: taskId, status: "succeeded", result: data ?? null }
			: { id: taskId, status: "failed", error: { code: "run_error", message: result.text } };
	const computedResult: PluginBackgroundResult = {
		pluginId: deps.pluginId,
		toolName: job.plugin.toolName,
		input: job.plugin.input,
		outcome,
		text: result.text,
		...(data === undefined ? {} : { data }),
	};

	let targetJob = job;
	let payload: PluginBackgroundResult = (job.result as PluginBackgroundResult | undefined) ?? computedResult;

	if (job.status === "running" || !job.delivery) {
		const activity =
			typeof result.activity === "string" && result.activity.trim()
				? result.activity.trim()
				: result.status === "succeeded"
					? "finished"
					: "failed";
		targetJob =
			deps.jobStore.updateJob(job.id, {
				status: result.status === "succeeded" ? "done" : "error",
				error: result.status === "succeeded" ? undefined : result.text,
				activity,
				result: computedResult,
				delivery: { kind: "result", status: "pending" },
			}) ?? { ...job, result: computedResult };
		payload = computedResult;
	}

	void deps.deliver(buildSubagentSteer(targetJob, payload)).catch((error: unknown) => {
		console.error(`[external job ${targetJob.id}] result delivery remains pending:`, error);
	});
}

export function createPluginTeachingSession(
	deps: TeachingSessionServiceDeps,
	init: PluginTeachingSessionInit,
): PluginTeachingSessionHandle {
	assertActive(deps.isActive);
	const rawTitle = typeof init?.title === "string" ? init.title.trim() : "";
	if (!rawTitle) throw new Error("createTeachingSession requires a non-empty title");

	const chat = deps.chatStore.createChat(titleFromPrompt(rawTitle));
	const strong = deps.readSettings()?.models?.strong;
	if (strong?.model) {
		deps.chatStore.saveSettings(chat.id, {
			model: { provider: strong.model.provider, id: strong.model.id },
			thinkingLevel: strong.thinkingLevel,
		});
	}

	if (Array.isArray(init.propositionIds) && init.propositionIds.length > 0) {
		const wanted = [...new Set(init.propositionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))].slice(0, 64);
		const allNodes = deps.graphStore.readNodes();
		const byId = new Map(allNodes.map((n) => [n.id, n]));
		const pickedNodes = wanted.map((id) => byId.get(id)).filter((n): n is NonNullable<typeof n> => n !== undefined);
		const picks: GraphContextPick[] = pickedNodes.map((n) => ({
			id: n.id,
			name: n.name,
			statement: n.statement,
		}));
		if (picks.length > 0) {
			const chainLines = chainsForSelection(pickedNodes, deps.graphStore.readChains()).map((c) =>
				formatChainLine(c, Object.fromEntries(byId)),
			);
			deps.chatStore.saveMessages(chat.id, [newGraphContextMessage(picks, chainLines)]);
		}
	}

	const openingPrompt = typeof init.openingPrompt === "string" ? init.openingPrompt.trim() : "";
	const sessionPath = openingPrompt ? `/chat/${chat.id}?prompt=${encodeURIComponent(openingPrompt)}` : `/chat/${chat.id}`;
	return {
		id: chat.id,
		title: chat.title,
		path: sessionPath,
	};
}
