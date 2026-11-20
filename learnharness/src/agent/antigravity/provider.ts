import { createProvider, type Api, type Model, type Provider, type SimpleStreamOptions, type StreamFunction } from "@earendil-works/pi-ai";
import { ANTIGRAVITY_PROVIDER } from "./constants.ts";
import { getAntigravityModels } from "./models-catalog.ts";

export function createAntigravityProvider(
	streamSimple: StreamFunction<Api, SimpleStreamOptions>,
	models: readonly Model<Api>[] = getAntigravityModels(),
): Provider {
	return createProvider({
		id: ANTIGRAVITY_PROVIDER,
		name: "Antigravity (ACP)",
		auth: {
			apiKey: {
				name: "Antigravity ACP CLI",
				resolve: async () => ({ auth: {}, source: "agy ACP" }),
			},
		},
		models,
		api: { stream: streamSimple, streamSimple },
	});
}
