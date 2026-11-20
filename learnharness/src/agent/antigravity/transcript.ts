import type { Api, ImageContent, Message, Model, TextContent, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";

export type AcpPromptBlock =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

export interface AntigravityInput {
	systemPrompt: string;
	tools: Tool[];
	promptBlocks: AcpPromptBlock[];
}

type ReplayPart = string | ImageContent;

function getLabelledParts(label: string, content: string | (TextContent | ImageContent)[]): ReplayPart[] {
	if (typeof content === "string") return [`${label}\n${content}`];

	const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	const images = content.filter((block): block is ImageContent => block.type === "image");

	return [text ? `${label}\n${text}` : label, ...images];
}

function getReplayParts(message: Message): ReplayPart[] {
	switch (message.role) {
		case "system":
			return [];

		case "user":
			return getLabelledParts("[user]", message.content);

		case "assistant":
			return message.content.flatMap((block) => {
				if (block.type === "text") return [`[assistant]\n${block.text}`];
				if (block.type === "toolCall") return [`[tool call ${block.name}] ${JSON.stringify(block.arguments)}`];
				return [];
			});

		case "toolResult": {
			const label = message.isError ? `[tool result ${message.toolName} error]` : `[tool result ${message.toolName}]`;
			return getLabelledParts(label, message.content);
		}
	}
}

function toAcpBlocks(parts: ReplayPart[]): AcpPromptBlock[] {
	const blocks: AcpPromptBlock[] = [];
	let pendingText: string[] = [];

	const flushText = () => {
		if (pendingText.length > 0) blocks.push({ type: "text", text: pendingText.join("\n\n") });
		pendingText = [];
	};

	for (const part of parts) {
		if (typeof part === "string") {
			pendingText.push(part);
		} else {
			flushText();
			blocks.push({ type: "image", data: part.data, mimeType: part.mimeType });
		}
	}

	flushText();
	return blocks;
}

function toUnlabelledBlocks(content: string | (TextContent | ImageContent)[]): AcpPromptBlock[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return content.map((block) => (
		block.type === "text"
			? { type: "text", text: block.text }
			: { type: "image", data: block.data, mimeType: block.mimeType }
	));
}

function toPromptBlocks(conversation: Message[]): AcpPromptBlock[] {
	const [first] = conversation;
	if (conversation.length === 1 && first?.role === "user") {
		const blocks = toUnlabelledBlocks(first.content);
		return blocks.length > 0 ? blocks : [{ type: "text", text: "Continue." }];
	}
	const blocks = toAcpBlocks(conversation.flatMap(getReplayParts));
	return blocks.length > 0 ? blocks : [{ type: "text", text: "Continue with the conversation." }];
}

export function toAntigravityInput(messages: Message[]): AntigravityInput {
	const conversation = messages.filter((message) => message.role !== "system");
	return {
		systemPrompt: getCurrentSystemPrompt(messages),
		tools: getCurrentTools(messages),
		promptBlocks: toPromptBlocks(conversation),
	};
}

/** Compare model-visible history, not app IDs, timestamps, usage, or Pi's added thinkingLevel. */
export function conversationForReuse(messages: Message[]): unknown[] {
	return messages.flatMap((message): unknown[] => {
		switch (message.role) {
			case "system": return [];
			case "user": return [{ role: message.role, content: message.content }];
			case "assistant": return [{ role: message.role, content: message.content }];
			case "toolResult": return [{
				role: message.role,
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				content: message.content,
				isError: message.isError,
			}];
		}
	});
}

export function configurationForReuse(model: Model<Api>, context: TranscriptContext, thoughtLevel: string | undefined): unknown {
	const systemPrompt = getCurrentSystemPrompt(context.messages);
	const tools = getCurrentTools(context.messages);
	return JSON.parse(JSON.stringify({ model, thoughtLevel: thoughtLevel ?? null, systemPrompt, tools })) as unknown;
}
