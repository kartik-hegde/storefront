import type { ExecuteOptions, IdempotencyResult, IdempotencyStore } from "@signet/webmcp";

const DATABASE_NAME = "saleor-signet";
const STORE_NAME = "completed-operations";
const DATABASE_VERSION = 1;

type StoredOperation = {
	key: string;
	value: unknown;
	completedAt: string;
};

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Unable to open the Signet operation store."));
	});
}

async function readOperation<Output>(key: string): Promise<Output | undefined> {
	const database = await openDatabase();
	try {
		return await new Promise<Output | undefined>((resolve, reject) => {
			const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
			request.onsuccess = () =>
				resolve((request.result as StoredOperation | undefined)?.value as Output | undefined);
			request.onerror = () =>
				reject(request.error ?? new Error("Unable to read the Signet operation store."));
		});
	} finally {
		database.close();
	}
}

async function writeOperation<Output>(key: string, value: Output): Promise<void> {
	const database = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction.objectStore(STORE_NAME).put({
				key,
				value,
				completedAt: new Date().toISOString(),
			} satisfies StoredOperation);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error("Unable to save the Signet operation."));
			transaction.onabort = () =>
				reject(transaction.error ?? new Error("Saving the Signet operation was aborted."));
		});
	} finally {
		database.close();
	}
}

/**
 * Persists completed operations for the lifetime of this browser profile and
 * uses the Web Locks API to coalesce equal intent across tabs.
 */
export class IndexedDbIdempotencyStore implements IdempotencyStore {
	readonly #pending = new Map<string, Promise<unknown>>();

	async execute<Output>(
		key: string,
		operation: () => Promise<Output>,
		options: ExecuteOptions,
	): Promise<IdempotencyResult<Output>> {
		options.signal.throwIfAborted();

		const pending = this.#pending.get(key) as Promise<Output> | undefined;
		if (pending) {
			return { value: await pending, replayed: true };
		}

		const run = this.#executeLocked(key, operation, options);
		this.#pending.set(
			key,
			run.then((result) => result.value),
		);
		try {
			return await run;
		} finally {
			this.#pending.delete(key);
		}
	}

	async #executeLocked<Output>(
		key: string,
		operation: () => Promise<Output>,
		options: ExecuteOptions,
	): Promise<IdempotencyResult<Output>> {
		const execute = async (): Promise<IdempotencyResult<Output>> => {
			options.signal.throwIfAborted();
			const saved = await readOperation<Output>(key);
			if (saved !== undefined) {
				return { value: saved, replayed: true };
			}

			const value = await operation();
			await writeOperation(key, value);
			return { value, replayed: false };
		};

		if (navigator.locks) {
			return navigator.locks.request(`signet:${key}`, { signal: options.signal }, execute);
		}

		return execute();
	}
}
