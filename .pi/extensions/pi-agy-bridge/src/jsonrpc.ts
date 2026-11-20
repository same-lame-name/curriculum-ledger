// Newline-delimited JSON-RPC 2.0 session over a stdio transport.

import { isKnownNoiseLine, MAX_FRAME_BYTES, stripGluedNoise } from "./frame-guard.ts";

export interface JsonRpcErrorShape {
	code: number;
	message: string;
	data?: unknown;
}

export class JsonRpcResponseError extends Error {
	readonly code: number;
	readonly data?: unknown;
	constructor(err: JsonRpcErrorShape) {
		super(err.message);
		this.name = "JsonRpcResponseError";
		this.code = err.code;
		this.data = err.data;
	}
}

export interface JsonRpcIncoming {
	id?: number | string | null;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: JsonRpcErrorShape;
}

export type SendFn = (frame: string) => void;

export interface JsonRpcSessionOptions {
	send: SendFn;
	onRequest?: (method: string, params: unknown) => Promise<unknown>;
	onNotification?: (method: string, params: unknown) => void;
	onParseError?: (line: string) => void;
	onOverflow?: (detail: string) => void;
	defaultTimeoutMs?: number;
}

interface Pending {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
	method: string;
}

export class JsonRpcSession {
	#send: SendFn;
	#opts: JsonRpcSessionOptions;
	#pending = new Map<number, Pending>();
	#nextId = 1;
	#aborted = false;
	#overflowed = false;
	#lineBuf = "";
	parseErrors = 0;

	constructor(opts: JsonRpcSessionOptions) {
		this.#opts = opts;
		this.#send = opts.send;
	}

	feed(chunk: string): void {
		if (this.#overflowed) return;
		this.#lineBuf += chunk;
		if (this.#lineBuf.length > MAX_FRAME_BYTES) {
			const detail = `${this.#lineBuf.length} bytes buffered with no newline (cap ${MAX_FRAME_BYTES})`;
			this.#overflow(detail);
			return;
		}
		const lines = this.#lineBuf.split("\n");
		this.#lineBuf = lines.pop() ?? "";
		for (const raw of lines) {
			const line = raw.trim();
			if (!line) continue;
			if (isKnownNoiseLine(line)) continue;
			let msg: JsonRpcIncoming;
			try {
				msg = JSON.parse(line) as JsonRpcIncoming;
			} catch {
				const repaired = stripGluedNoise(line);
				if (repaired) {
					try {
						msg = JSON.parse(repaired) as JsonRpcIncoming;
					} catch {
						this.parseErrors += 1;
						this.#opts.onParseError?.(line.slice(0, 200));
						continue;
					}
				} else {
					this.parseErrors += 1;
					this.#opts.onParseError?.(line.slice(0, 200));
					continue;
				}
			}
			this.#handleMessage(msg);
		}
	}

	#overflow(detail: string): void {
		this.#overflowed = true;
		this.#lineBuf = "";
		this.abortAll(`stdout frame overflow: ${detail}`);
		this.#opts.onOverflow?.(detail);
	}

	#handleMessage(msg: JsonRpcIncoming): void {
		// Response to a request we sent
		if (msg.method === undefined && msg.id !== undefined && msg.id !== null) {
			const id = Number(msg.id);
			const pending = this.#pending.get(id);
			if (!pending) return;
			this.#pending.delete(id);
			if (pending.timer) clearTimeout(pending.timer);
			if (msg.error) {
				pending.reject(new JsonRpcResponseError(msg.error));
			} else {
				pending.resolve(msg.result);
			}
			return;
		}
		if (msg.method === undefined) return;
		// Server-to-client request (method + id)
		if (msg.id !== undefined && msg.id !== null) {
			const id = msg.id;
			const handler = this.#opts.onRequest;
			if (!handler) {
				this.#sendError(id, -32601, `client does not support method: ${msg.method}`);
				return;
			}
			void Promise.resolve()
				.then(() => handler(msg.method as string, msg.params))
				.then(
					(result) => this.#sendResult(id, result ?? {}),
					(err: unknown) => {
						const message = err instanceof Error ? err.message : String(err);
						this.#sendError(id, -32603, message);
					},
				);
			return;
		}
		// Server-to-client notification (method, no id)
		this.#opts.onNotification?.(msg.method, msg.params);
	}

	request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
		if (this.#aborted) return Promise.reject(new Error(`session already aborted: cannot call ${method}`));
		const id = this.#nextId++;
		const timeout = timeoutMs ?? this.#opts.defaultTimeoutMs ?? 0;
		return new Promise<unknown>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			if (timeout > 0) {
				timer = setTimeout(() => {
					this.#pending.delete(id);
					reject(new Error(`request ${method} (id ${id}) timed out after ${timeout}ms`));
				}, timeout);
			}
			this.#pending.set(id, { resolve, reject, timer, method });
			try {
				const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
				this.#send(frame);
			} catch (err) {
				if (timer) clearTimeout(timer);
				this.#pending.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	notify(method: string, params: unknown): void {
		if (this.#aborted) return;
		const frame = JSON.stringify({ jsonrpc: "2.0", method, params });
		this.#send(frame);
	}

	#sendResult(id: number | string, result: unknown): void {
		if (this.#aborted) return;
		const frame = JSON.stringify({ jsonrpc: "2.0", id, result });
		this.#send(frame);
	}

	#sendError(id: number | string, code: number, message: string): void {
		if (this.#aborted) return;
		const frame = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
		this.#send(frame);
	}

	abortAll(reason = "JSON-RPC session aborted"): void {
		this.#aborted = true;
		for (const [, p] of this.#pending) {
			if (p.timer) clearTimeout(p.timer);
			p.reject(new Error(`${reason} while waiting for ${p.method}`));
		}
		this.#pending.clear();
	}
}
