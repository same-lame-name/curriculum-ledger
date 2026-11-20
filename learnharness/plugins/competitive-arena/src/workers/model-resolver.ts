import type { PluginBackendContext, PluginModelSpec } from "learnharness-plugin-api";
import type { ArenaPluginSettings } from "../types.ts";

export async function resolveWorkerModel(
	ctx: PluginBackendContext,
	settings: ArenaPluginSettings,
): Promise<PluginModelSpec> {
	if (settings.workerModelOverride) {
		return {
			provider: settings.workerModelOverride.provider,
			id: settings.workerModelOverride.id,
			...(settings.workerThinkingOverride && settings.workerThinkingOverride !== "off"
				? { thinkingLevel: settings.workerThinkingOverride }
				: {}),
		};
	}

	const catalog = await ctx.inference.catalog();
	const cheap = catalog?.slots?.cheap;
	if (!cheap?.model) {
		throw new Error(
			"No cheap-tier model is configured for Competitive Arena workers. Configure the Cheap slot in Settings → Models or choose a worker model in Settings → Competitive Arena.",
		);
	}
	return {
		provider: cheap.model.provider,
		id: cheap.model.id,
		...(cheap.thinkingLevel && cheap.thinkingLevel !== "off"
			? { thinkingLevel: cheap.thinkingLevel }
			: {}),
	};
}
