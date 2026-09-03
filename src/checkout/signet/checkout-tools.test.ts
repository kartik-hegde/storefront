import { assertToolReady, createSignett, OutcomeUnknownError, VerificationError } from "signett";
import { TraceAssembler, toOtlpJson } from "signett/opentelemetry";
import { createWebMcpTestHarness, MemoryIdempotencyStore, MemoryOperationJournal } from "signett/testing";
import { describe, expect, it, vi } from "vitest";

import type { CheckoutGatewayMessagesHook } from "@/checkout/hooks/use-checkout-gateway-messages";
import type { ServerCheckout } from "@/checkout/lib/checkout-types";

import { CheckoutSnapshot } from "./checkout-model";
import type { CheckoutOperations } from "./checkout-operations";
import { createCheckoutTools } from "./checkout-tools";

const orderInput = {
	operationId: "operation-0001",
	expectedTotalAmount: 20,
	expectedCurrency: "USD",
};

function checkout(totalAmount = 20): ServerCheckout {
	return {
		id: "checkout-1",
		channel: { slug: "default-channel" },
		email: "ada@example.com",
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
		delivery: { id: "delivery-1" },
		isShippingRequired: true,
		availablePaymentGateways: [{ id: "mirumee.payments.dummy", name: "Dummy" }],
	} as unknown as ServerCheckout;
}

function setup(
	options: {
		idempotencyStore?: MemoryIdempotencyStore;
		journal?: MemoryOperationJournal;
		liveCheckout?: ServerCheckout;
		lostResponse?: boolean;
		getOrderProof?: ReturnType<typeof vi.fn>;
		updateEmail?: ReturnType<typeof vi.fn>;
		paymentResult?: { ok: true; orderId: string } | { ok: false; error: string };
	} = {},
) {
	const initial = checkout();
	const checkoutState = new CheckoutSnapshot();
	checkoutState.update(initial);
	const payment = vi.fn(async () => options.paymentResult ?? { ok: true as const, orderId: "order-1" });
	const proof = {
		orderId: "order-1",
		number: "1001",
		email: "ada@example.com",
		isPaid: true,
		lineCount: 1,
		totalAmount: 20,
		currency: "USD",
	};
	const getOrderProof = options.getOrderProof ?? vi.fn(async () => proof);
	const operations = {
		calculateDeliveryOptions: vi.fn(async () => ({ ok: true, deliveries: [] })),
		executeLegacyDummyPayment: payment,
		executePayment: payment,
		getOrderProof,
		resolvePaymentProvider: vi.fn(() => ({
			type: "dummy",
			gateway: { id: "mirumee.payments.dummy", name: "Dummy" },
			submitMode: "server",
		})),
		updateBillingAddress: vi.fn(async () => ({ ok: true })),
		updateDeliveryMethod: vi.fn(async () => ({ ok: true, checkout: initial })),
		updateEmail: options.updateEmail ?? vi.fn(async () => ({ ok: true, checkout: initial })),
		updateShippingAddress: vi.fn(async () => ({ ok: true, checkout: initial })),
	} as unknown as CheckoutOperations;
	const idempotencyStore = options.idempotencyStore ?? new MemoryIdempotencyStore();
	const journal = options.journal ?? new MemoryOperationJournal();
	const onVerifiedOrder = vi.fn();
	const onOrderAttemptFailed = vi.fn();
	let lostResponse = options.lostResponse ?? false;
	const confirm = vi.fn(async () => true);
	const tools = createCheckoutTools({
		checkoutState,
		consumeLostResponseFault: () => {
			if (!lostResponse) return false;
			lostResponse = false;
			return true;
		},
		gatewayMessages: {} as CheckoutGatewayMessagesHook,
		idempotencyStore,
		operationJournal: journal,
		onVerifiedOrder,
		onOrderAttemptFailed,
		operations,
		refreshCheckout: vi.fn(async () => options.liveCheckout ?? initial),
		requestApproval: confirm,
		setCheckout: (value) => checkoutState.update(value),
	});

	return {
		confirm,
		getOrderProof,
		idempotencyStore,
		journal,
		onOrderAttemptFailed,
		onVerifiedOrder,
		payment,
		tools,
	};
}

async function harnessFor(placeOrder: ReturnType<typeof setup>["tools"]["placeOrder"]) {
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
	await signett.expose(placeOrder);
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

		for (const tool of Object.values(tools)) {
			expect(() => assertToolReady(tool)).not.toThrow();
		}
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

	it("places one order and replays the result for the same intent", async () => {
		const { confirm, onVerifiedOrder, payment, tools } = setup();
		const harness = await harnessFor(tools.placeOrder);

		const first = await harness.invoke("place_order", orderInput);
		const replay = await harness.invoke("place_order", orderInput);

		expect(replay).toEqual(first);
		expect(payment).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
		expect(onVerifiedOrder).toHaveBeenCalledTimes(2);
	});

	it("emits privacy-safe OTEL evidence for execution and replay", async () => {
		const { payment, tools } = setup();
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
		await signett.expose(tools.placeOrder);

		await harness.invoke("place_order", orderInput);
		await harness.invoke("place_order", orderInput);

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
		expect(payment).toHaveBeenCalledOnce();

		const payload = JSON.stringify(toOtlpJson(snapshot, { serviceName: "signett-saleor-demo" }));
		expect(payload).not.toContain("ada@example.com");
		expect(payload).not.toContain(orderInput.operationId);
	});

	it("does not publish completion when the authoritative Saleor proof fails", async () => {
		const getOrderProof = vi.fn(async () => ({
			orderId: "order-1",
			number: "1001",
			email: "ada@example.com",
			isPaid: false,
			lineCount: 1,
			totalAmount: 20,
			currency: "USD",
		}));
		const { onVerifiedOrder, tools } = setup({ getOrderProof });
		const harness = await harnessFor(tools.placeOrder);

		await expect(harness.invoke("place_order", orderInput)).rejects.toBeInstanceOf(VerificationError);
		expect(onVerifiedOrder).not.toHaveBeenCalled();
	});

	it("coalesces concurrent calls with the same operation ID", async () => {
		const { confirm, payment, tools } = setup();
		const harness = await harnessFor(tools.placeOrder);

		const [first, duplicate] = await Promise.all([
			harness.invoke("place_order", orderInput),
			harness.invoke("place_order", orderInput),
		]);

		expect(duplicate).toEqual(first);
		expect(payment).toHaveBeenCalledOnce();
		expect(confirm).toHaveBeenCalledOnce();
	});

	it("recovers a lost response on a fresh tool instance without paying twice", async () => {
		const idempotencyStore = new MemoryIdempotencyStore();
		const journal = new MemoryOperationJournal();
		const getOrderProof = vi
			.fn()
			.mockRejectedValueOnce(new Error("verification temporarily unavailable"))
			.mockResolvedValue({
				orderId: "order-1",
				number: "1001",
				email: "ada@example.com",
				isPaid: true,
				lineCount: 1,
				totalAmount: 20,
				currency: "USD",
			});
		const first = setup({ idempotencyStore, journal, lostResponse: true, getOrderProof });
		const firstHarness = await harnessFor(first.tools.placeOrder);

		await expect(firstHarness.invoke("place_order", orderInput)).rejects.toBeInstanceOf(OutcomeUnknownError);

		const afterReload = setup({ idempotencyStore, journal, getOrderProof });
		const reloadHarness = await harnessFor(afterReload.tools.placeOrder);
		await expect(reloadHarness.invoke("place_order", orderInput)).resolves.toMatchObject({
			orderId: "order-1",
			status: "placed",
		});
		expect(first.payment).toHaveBeenCalledOnce();
		expect(afterReload.payment).not.toHaveBeenCalled();
		expect(afterReload.confirm).not.toHaveBeenCalled();
		expect(
			journal.read("checkout-1:operation-0001:place:USD:20.00", {
				signal: new AbortController().signal,
			}),
		).toBeUndefined();
	});

	it("rejects a stale total before payment and leaves the intent retryable", async () => {
		const { confirm, payment, tools } = setup({ liveCheckout: checkout(21) });
		const harness = await harnessFor(tools.placeOrder);

		await expect(harness.invoke("place_order", orderInput)).rejects.toThrow(
			"Checkout total changed to USD 21.00",
		);
		await expect(harness.invoke("place_order", orderInput)).rejects.toThrow(
			"Checkout total changed to USD 21.00",
		);
		expect(payment).not.toHaveBeenCalled();
		expect(confirm).toHaveBeenCalledTimes(2);
	});

	it("cancels an armed response-loss simulation when payment fails before order creation", async () => {
		const { onOrderAttemptFailed, tools } = setup({
			lostResponse: true,
			paymentResult: { ok: false, error: "Payment app unavailable" },
		});
		const harness = await harnessFor(tools.placeOrder);

		await expect(harness.invoke("place_order", orderInput)).rejects.toMatchObject({
			code: "payment_provider_unavailable",
			retry: "after_repair",
		});
		expect(onOrderAttemptFailed).toHaveBeenCalledOnce();
	});

	it("rejects invented arguments before any application action", async () => {
		const { payment, tools } = setup();
		const harness = await harnessFor(tools.placeOrder);

		await expect(harness.invoke("place_order", { ...orderInput, discountOverride: 100 })).rejects.toThrow(
			"not allowed",
		);
		expect(payment).not.toHaveBeenCalled();
	});
});
