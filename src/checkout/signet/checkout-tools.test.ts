import { assertToolReady, createSignett, VerificationError } from "signett";
import { TraceAssembler, toOtlpJson } from "signett/opentelemetry";
import { createWebMcpTestHarness, MemoryIdempotencyStore, MemoryOperationJournal } from "signett/testing";
import { describe, expect, it, vi } from "vitest";

import type { ServerCheckout } from "@/checkout/lib/checkout-types";

import { CheckoutSnapshot } from "./checkout-model";
import type { CheckoutOperations } from "./checkout-operations";
import { createCheckoutTools, type CheckoutToolDependencies } from "./checkout-tools";

const requestInput = {
	operationId: "operation-0001",
	expectedTotalAmount: 20,
	expectedCurrency: "USD",
};

function checkout(totalAmount = 20, customerNote = ""): ServerCheckout {
	return {
		id: "checkout-1",
		channel: { slug: "default-channel" },
		email: "ada@example.com",
		customerNote,
		lines: [{ quantity: 1 }],
		totalPrice: { gross: { amount: totalAmount, currency: "USD" } },
		shippingAddress: {
			firstName: "Ada",
			lastName: "Lovelace",
			companyName: "",
			streetAddress1: "1 Analytical Engine Way",
			streetAddress2: "",
			city: "London",
			cityArea: "",
			countryArea: "London",
			postalCode: "SW1A 1AA",
			country: { code: "GB" },
			phone: "",
		},
		delivery: { id: "delivery-1", shippingMethod: { name: "Courier" } },
		isShippingRequired: true,
	} as unknown as ServerCheckout;
}

type SharedCheckout = { current: ServerCheckout };

function setup(
	options: {
		idempotencyStore?: MemoryIdempotencyStore;
		journal?: MemoryOperationJournal;
		sharedCheckout?: SharedCheckout;
		liveCheckout?: ServerCheckout;
		lostResponse?: boolean;
		refreshCheckout?: ReturnType<typeof vi.fn>;
		updateCustomerNote?: ReturnType<typeof vi.fn>;
		updateEmail?: ReturnType<typeof vi.fn>;
	} = {},
) {
	const sharedCheckout = options.sharedCheckout ?? { current: options.liveCheckout ?? checkout() };
	const checkoutState = new CheckoutSnapshot();
	checkoutState.update(sharedCheckout.current);
	const updateCustomerNote =
		options.updateCustomerNote ??
		vi.fn(async (_checkoutId: string, customerNote: string) => {
			sharedCheckout.current = { ...sharedCheckout.current, customerNote };
			return { ok: true as const, checkout: sharedCheckout.current };
		});
	const operations = {
		calculateDeliveryOptions: vi.fn(async () => ({ ok: true, deliveries: [] })),
		updateCustomerNote,
		updateDeliveryMethod: vi.fn(async () => ({ ok: true, checkout: sharedCheckout.current })),
		updateEmail: options.updateEmail ?? vi.fn(async () => ({ ok: true, checkout: sharedCheckout.current })),
		updateShippingAddress: vi.fn(async () => ({ ok: true, checkout: sharedCheckout.current })),
	} as unknown as CheckoutOperations;
	const idempotencyStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
	const journal = options.journal ?? new MemoryOperationJournal();
	const onVerifiedRequest = vi.fn();
	const onRequestAttemptFailed = vi.fn();
	let lostResponse = options.lostResponse ?? false;
	const confirm = vi.fn(async () => true);
	const refreshCheckout = options.refreshCheckout ?? vi.fn(async () => sharedCheckout.current);
	const tools = createCheckoutTools({
		checkoutState,
		consumeLostResponseFault: () => {
			if (!lostResponse) return false;
			lostResponse = false;
			return true;
		},
		idempotencyStore,
		operationJournal: journal,
		onVerifiedRequest,
		onRequestAttemptFailed,
		operations,
		refreshCheckout: refreshCheckout as CheckoutToolDependencies["refreshCheckout"],
		requestApproval: confirm,
		setCheckout: (value) => checkoutState.update(value),
	});

	return {
		confirm,
		onRequestAttemptFailed,
		onVerifiedRequest,
		tools,
		updateCustomerNote,
	};
}

async function harnessFor(submitRequest: ReturnType<typeof setup>["tools"]["submitRequest"]) {
	const harness = createWebMcpTestHarness();
	const signett = createSignett({
		modelContext: harness.modelContext,
		context: () => ({
			checkoutId: "checkout-1",
			channel: "default-channel",
			email: "ada@example.com",
			lineCount: 1,
			totalAmount: 20,
			currency: "USD",
		}),
	});
	await signett.expose(submitRequest);
	return harness;
}

async function harnessForContact(contact: ReturnType<typeof setup>["tools"]["contact"]) {
	const harness = createWebMcpTestHarness();
	const signett = createSignett({
		modelContext: harness.modelContext,
		context: () => ({
			checkoutId: "checkout-1",
			channel: "default-channel",
			email: "ada@example.com",
			lineCount: 1,
			totalAmount: 20,
			currency: "USD",
		}),
	});
	await signett.expose(contact);
	return harness;
}

describe("Saleor Signett checkout tools", () => {
	it("keeps all five production tools agent-ready", () => {
		const { tools } = setup();
		for (const tool of Object.values(tools)) expect(() => assertToolReady(tool)).not.toThrow();
	});

	it("leaves a rejected contact update directly retryable", async () => {
		const updateEmail = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, error: "Saleor rejected the checkout email." })
			.mockResolvedValue({ ok: true, checkout: checkout() });
		const { tools } = setup({ updateEmail });
		const harness = await harnessForContact(tools.contact);
		const input = {
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
			streetAddress1: "1 Analytical Engine Way",
			city: "London",
			countryArea: "London",
			postalCode: "SW1A 1AA",
			countryCode: "GB",
		};

		await expect(harness.invoke("set_checkout_contact", input)).rejects.toThrow(
			"Saleor rejected the checkout email.",
		);
		await expect(harness.invoke("set_checkout_contact", input)).resolves.toBeDefined();
		expect(updateEmail).toHaveBeenCalledTimes(2);
	});

	it("submits one real checkout request and replays the same intent", async () => {
		const { confirm, onVerifiedRequest, tools, updateCustomerNote } = setup();
		const harness = await harnessFor(tools.submitRequest);

		const first = await harness.invoke("submit_purchase_request", requestInput);
		const replay = await harness.invoke("submit_purchase_request", requestInput);

		expect(first).toMatchObject({ checkoutId: "checkout-1", status: "submitted" });
		expect(replay).toEqual(first);
		expect(updateCustomerNote).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
		expect(onVerifiedRequest).toHaveBeenCalledTimes(2);
	});

	it("emits privacy-safe OTEL evidence for execution and replay", async () => {
		const { tools, updateCustomerNote } = setup();
		const harness = createWebMcpTestHarness();
		const traces = new TraceAssembler();
		const signett = createSignett({
			modelContext: harness.modelContext,
			context: () => ({
				checkoutId: "checkout-1",
				channel: "default-channel",
				email: "ada@example.com",
				lineCount: 1,
				totalAmount: 20,
				currency: "USD",
			}),
			observe: (event) => {
				traces.observe(event);
			},
		});
		await signett.expose(tools.submitRequest);

		await harness.invoke("submit_purchase_request", requestInput);
		await harness.invoke("submit_purchase_request", requestInput);

		const snapshot = traces.snapshot();
		expect(snapshot.map((trace) => trace.outcome)).toEqual(["replayed", "succeeded"]);
		expect(snapshot[1]?.phases.map((phase) => phase.name)).toEqual(
			expect.arrayContaining([
				"signett.validate",
				"signett.authorize",
				"signett.confirm",
				"signett.execute",
				"signett.verify",
			]),
		);
		expect(updateCustomerNote).toHaveBeenCalledOnce();
		const payload = JSON.stringify(toOtlpJson(snapshot, { serviceName: "signett-saleor-demo" }));
		expect(payload).not.toContain("ada@example.com");
		expect(payload).not.toContain(requestInput.operationId);
	});

	it("does not publish completion when Saleor no longer contains the request marker", async () => {
		const sharedCheckout = { current: checkout() };
		const refreshCheckout = vi
			.fn()
			.mockImplementationOnce(async () => sharedCheckout.current)
			.mockImplementation(async () => checkout());
		const { onVerifiedRequest, tools } = setup({ sharedCheckout, refreshCheckout });
		const harness = await harnessFor(tools.submitRequest);

		await expect(harness.invoke("submit_purchase_request", requestInput)).rejects.toBeInstanceOf(
			VerificationError,
		);
		expect(onVerifiedRequest).not.toHaveBeenCalled();
	});

	it("coalesces concurrent calls with the same operation ID", async () => {
		const { confirm, tools, updateCustomerNote } = setup();
		const harness = await harnessFor(tools.submitRequest);
		const [first, duplicate] = await Promise.all([
			harness.invoke("submit_purchase_request", requestInput),
			harness.invoke("submit_purchase_request", requestInput),
		]);

		expect(duplicate).toEqual(first);
		expect(updateCustomerNote).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
	});

	it("recovers a lost response from Saleor without a second mutation or approval", async () => {
		const { confirm, onVerifiedRequest, tools, updateCustomerNote } = setup({ lostResponse: true });
		const harness = await harnessFor(tools.submitRequest);

		await expect(harness.invoke("submit_purchase_request", requestInput)).resolves.toMatchObject({
			checkoutId: "checkout-1",
			status: "submitted",
		});
		expect(updateCustomerNote).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
		expect(onVerifiedRequest).toHaveBeenCalledOnce();
	});

	it("rejects a stale total before mutation and leaves the intent retryable", async () => {
		const { confirm, tools, updateCustomerNote } = setup({ liveCheckout: checkout(21) });
		const harness = await harnessFor(tools.submitRequest);
		await expect(harness.invoke("submit_purchase_request", requestInput)).rejects.toThrow(
			"Checkout total changed to USD 21.00",
		);
		await expect(harness.invoke("submit_purchase_request", requestInput)).rejects.toThrow(
			"Checkout total changed to USD 21.00",
		);
		expect(updateCustomerNote).not.toHaveBeenCalled();
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("cancels an armed simulation when Saleor rejects the request before commit", async () => {
		const updateCustomerNote = vi.fn(async () => ({ ok: false, error: "Saleor unavailable" }));
		const { onRequestAttemptFailed, tools } = setup({ lostResponse: true, updateCustomerNote });
		const harness = await harnessFor(tools.submitRequest);
		await expect(harness.invoke("submit_purchase_request", requestInput)).rejects.toMatchObject({
			code: "purchase_request_failed",
			retry: "after_repair",
		});
		expect(onRequestAttemptFailed).toHaveBeenCalledOnce();
	});

	it("rejects invented arguments before any application action", async () => {
		const { tools, updateCustomerNote } = setup();
		const harness = await harnessFor(tools.submitRequest);
		await expect(
			harness.invoke("submit_purchase_request", { ...requestInput, discountOverride: 100 }),
		).rejects.toThrow("not allowed");
		expect(updateCustomerNote).not.toHaveBeenCalled();
	});
});
