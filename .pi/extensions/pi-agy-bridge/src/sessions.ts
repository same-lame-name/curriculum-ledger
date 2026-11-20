// Atomic session store mapping Pi sessions to Antigravity ACP session IDs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SessionRecord {
	sessionId: string;
	systemPromptHash?: string;
	lastUpdated: number;
}

export class SessionStore {
	#filePath: string;
	#data = new Map<string, SessionRecord>();

	constructor(customPath?: string) {
		this.#filePath = customPath ?? path.join(os.homedir(), ".pi", "agent", "antigravity-bridge", "sessions.json");
		this.#load();
	}

	#load(): void {
		try {
			if (!fs.existsSync(this.#filePath)) return;
			const raw = fs.readFileSync(this.#filePath, "utf8");
			const json = JSON.parse(raw) as Record<string, SessionRecord>;
			for (const [k, v] of Object.entries(json)) {
				this.#data.set(k, v);
			}
		} catch {
			// Best-effort load; fresh memory state on error
		}
	}

	#persist(): void {
		try {
			const dir = path.dirname(this.#filePath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			const obj = Object.fromEntries(this.#data.entries());
			const tmp = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
			fs.renameSync(tmp, this.#filePath);
		} catch {
			// Best-effort persist
		}
	}

	get(piSessionId: string): string | undefined {
		return this.#data.get(piSessionId)?.sessionId;
	}

	getRecord(piSessionId: string): SessionRecord | undefined {
		return this.#data.get(piSessionId);
	}

	set(piSessionId: string, agySessionId: string, systemPromptHash?: string): void {
		this.#data.set(piSessionId, {
			sessionId: agySessionId,
			...(systemPromptHash !== undefined ? { systemPromptHash } : {}),
			lastUpdated: Date.now(),
		});
		this.#persist();
	}

	delete(piSessionId: string): void {
		if (this.#data.delete(piSessionId)) {
			this.#persist();
		}
	}
}
