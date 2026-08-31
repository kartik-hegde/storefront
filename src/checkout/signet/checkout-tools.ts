import type { IdempotencyStore, OperationJournal, SignetTool } from "@signet/webmcp";

import {
	calculateDeliveryOptions,
	executeSignetLegacyDummyPayment,
	getSignetOrderProof,
	updateCheckoutBillingAddress,
	updateCheckoutDeliveryMethod,
	updateCheckoutEmail,
	updateCheckoutShippingAddress,
	type SignetOrderProof,
} from "@/app/(checkout)/actions";
import type { CheckoutGatewayMessagesHook } from "@/checkout/hooks/use-checkout-gateway-messages";
import { executePayment, resolvePaymentProvider } from "@/checkout/lib/payment";
import { getCheckoutPayAmount, getCheckoutPayCurrency } from "@/checkout/lib/payment/checkout-pay-amount";
import type { CheckoutDataContextValue } from "@/checkout/providers/checkout-data";

import {
	checkoutContext,
	type CheckoutContext,
	type CheckoutSnapshot,
	type ContactInput,
	type DeliveryInput,
	LOST_RESPONSE_FAULT,
	nearlyEqual,
	type PlaceOrderInput,
	requireCheckout,
	shippingAddressInput,
	toAddressInput,
} from "./checkout-model";

type OrderResult = SignetOrderProof & { status: "placed" };
type OrderCorrelation = { phase: "payment_started" } | { phase: "order_created"; orderId: string };

type ToolDependencies = {
	checkoutState: CheckoutSnapshot;
	refreshCheckout: CheckoutDataContextValue["refreshCheckout"];
	setCheckout: CheckoutDataContextValue["setCheckout"];
	gatewayMessages: CheckoutGatewayMessagesHook;
	idempotencyStore: IdempotencyStore;
	operationJournal: OperationJournal;
	requestApproval(title: string, detail: string): Promise<boolean>;
	onFaultConsumed(): void;
};

export type CheckoutToolSet = {
	inspect: SignetTool<Record<string, never>, CheckoutContext, CheckoutContext>;
	contact: SignetTool<ContactInput, CheckoutContext, CheckoutContext>;
	deliveryOptions: SignetTool<
		Record<string, never>,
		{ deliveries: Array<Record<string, unknown>> },
		CheckoutContext
	>;
	delivery: SignetTool<DeliveryInput, CheckoutContext, CheckoutContext>;
	placeOrder: SignetTool<PlaceOrderInput, OrderResult, CheckoutContext>;
};

export function createCheckoutTools(dependencies: ToolDependencies): CheckoutToolSet {
	const {
		checkoutState,
		gatewayMessages,
		idempotencyStore,
		onFaultConsumed,
		operationJournal,
		refreshCheckout,
		requestApproval,
		setCheckout,
	} = dependencies;

	const inspect: CheckoutToolSet["inspect"] = {
		name: "inspect_checkout",
		title: "Inspect checkout",
		description:
			"Read the active Saleor checkout, including line count, customer email, current total, and currency. Call this before making checkout changes.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		execute: () => checkoutContext(checkoutState.read()),
	};

	const contact: CheckoutToolSet["contact"] = {
		name: "set_checkout_contact",
		title: "Set checkout contact and shipping address",
		description:
			"Set the guest email and shipping address on the active Saleor checkout. Use a fresh operationId for a new intent and reuse it only when retrying the exact same change.",
		inputSchema: {
			type: "object",
			properties: {
				operationId: { type: "string", minLength: 8 },
				email: { type: "string", minLength: 3 },
				firstName: { type: "string", minLength: 1 },
				lastName: { type: "string", minLength: 1 },
				streetAddress1: { type: "string", minLength: 1 },
				streetAddress2: { type: "string" },
				city: { type: "string", minLength: 1 },
				countryArea: { type: "string", minLength: 1 },
				postalCode: { type: "string", minLength: 1 },
				countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
				phone: { type: "string" },
			},
			required: [
				"operationId",
				"email",
				"firstName",
				"lastName",
				"streetAddress1",
				"city",
				"countryArea",
				"postalCode",
				"countryCode",
			],
			additionalProperties: false,
		},
		authorize: requireActiveCheckout,
		idempotency: {
			store: idempotencyStore,
			key: ({ input, context }) =>
				`${context.checkoutId}:${input.operationId}:contact:${JSON.stringify([
					input.email,
					input.firstName,
					input.lastName,
					input.streetAddress1,
					input.streetAddress2 ?? "",
					input.city,
					input.countryArea,
					input.postalCode,
					input.countryCode,
					input.phone ?? "",
				])}`,
		},
		execute: async (input) => {
			const active = requireCheckout(checkoutState.read());
			const emailResult = await updateCheckoutEmail(active.id, input.email);
			if (!emailResult.ok) throw new Error(emailResult.error ?? "Saleor rejected the checkout email.");

			const addressResult = await updateCheckoutShippingAddress(active.id, toAddressInput(input), false);
			if (!addressResult.ok) {
				throw new Error(addressResult.error ?? "Saleor rejected the shipping address.");
			}

			return await refreshAndAdopt(refreshCheckout, setCheckout);
		},
		verify: async ({ input }) => {
			const fresh = await refreshCheckout({ updateState: false });
			return (
				fresh?.email === input.email &&
				fresh.shippingAddress?.postalCode === input.postalCode &&
				fresh.shippingAddress.country.code === input.countryCode
			);
		},
	};

	const deliveryOptions: CheckoutToolSet["deliveryOptions"] = {
		name: "list_delivery_options",
		title: "List delivery options",
		description:
			"Calculate the currently eligible Saleor delivery options after the shipping address has been set.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
		execute: async () => {
			const active = requireCheckout(checkoutState.read());
			const result = await calculateDeliveryOptions(active.id);
			if (!result.ok) throw new Error(result.error ?? "Saleor could not calculate delivery options.");
			return {
				deliveries: result.deliveries.map((delivery) => ({
					deliveryId: delivery.id,
					name: delivery.shippingMethod?.name ?? "Delivery",
					price: delivery.shippingMethod?.price.amount ?? null,
					currency: delivery.shippingMethod?.price.currency ?? null,
					minimumDays: delivery.shippingMethod?.minimumDeliveryDays ?? null,
					maximumDays: delivery.shippingMethod?.maximumDeliveryDays ?? null,
				})),
			};
		},
	};

	const delivery: CheckoutToolSet["delivery"] = {
		name: "select_delivery_option",
		title: "Select delivery option",
		description:
			"Select one eligible deliveryId returned by list_delivery_options for the active Saleor checkout.",
		inputSchema: {
			type: "object",
			properties: {
				operationId: { type: "string", minLength: 8 },
				deliveryId: { type: "string", minLength: 1 },
			},
			required: ["operationId", "deliveryId"],
			additionalProperties: false,
		},
		authorize: requireActiveCheckout,
		idempotency: {
			store: idempotencyStore,
			key: ({ input, context }) => `${context.checkoutId}:${input.operationId}:delivery:${input.deliveryId}`,
		},
		execute: async ({ deliveryId }) => {
			const active = requireCheckout(checkoutState.read());
			const result = await updateCheckoutDeliveryMethod(active.id, deliveryId);
			if (!result.ok) throw new Error(result.error ?? "Saleor rejected the delivery option.");
			return await refreshAndAdopt(refreshCheckout, setCheckout);
		},
		verify: async ({ input }) => {
			const fresh = await refreshCheckout({ updateState: false });
			return fresh?.delivery?.id === input.deliveryId;
		},
	};

	const placeOrder: CheckoutToolSet["placeOrder"] = {
		name: "place_order",
		title: "Place order",
		description:
			"Charge the configured local test-payment gateway and convert the active Saleor checkout into one order. First inspect the checkout and provide the exact expected total and currency. Requires explicit shopper approval.",
		inputSchema: {
			type: "object",
			properties: {
				operationId: { type: "string", minLength: 8 },
				expectedTotalAmount: { type: "number", minimum: 0 },
				expectedCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
			},
			required: ["operationId", "expectedTotalAmount", "expectedCurrency"],
			additionalProperties: false,
		},
		authorize: requireActiveCheckout,
		confirm: {
			mode: "effect-only",
			request: ({ input, context }) =>
				requestApproval(
					"Approve this test order?",
					`${context.lineCount} item${context.lineCount === 1 ? "" : "s"} · ${input.expectedCurrency} ${input.expectedTotalAmount.toFixed(2)} · ${context.email ?? "guest checkout"}`,
				),
		},
		idempotency: {
			store: idempotencyStore,
			key: placeOrderKey,
		},
		journal: { store: operationJournal },
		execute: async (input, { operation }) => {
			const active = requireCheckout(checkoutState.read());
			const fresh = await refreshCheckout({ updateState: false });
			if (!fresh) throw new Error("Saleor could not refresh the checkout before payment.");

			const amount = getCheckoutPayAmount(fresh);
			const currency = getCheckoutPayCurrency(fresh);
			if (amount === null || currency === null) throw new Error("The live Saleor total is unavailable.");
			if (!nearlyEqual(amount, input.expectedTotalAmount) || currency !== input.expectedCurrency) {
				throw new Error(
					`Checkout total changed to ${currency} ${amount.toFixed(2)}; approval is required again.`,
				);
			}

			const billingAddress = shippingAddressInput(fresh);
			if (!billingAddress) throw new Error("Set a shipping address before placing the order.");
			if (!fresh.delivery && fresh.isShippingRequired) {
				throw new Error("Select a delivery option before placing the order.");
			}

			const billingResult = await updateCheckoutBillingAddress({
				checkoutId: active.id,
				billingAddress,
				saveAddress: false,
			});
			if (!billingResult.ok) throw new Error(billingResult.error ?? "Saleor rejected the billing address.");

			const paymentProvider = resolvePaymentProvider(fresh.availablePaymentGateways);
			await operation?.write<OrderCorrelation>({ phase: "payment_started" });
			const paymentResult =
				paymentProvider.type === "dummy" && paymentProvider.gateway.id === "mirumee.payments.dummy"
					? await executeSignetLegacyDummyPayment(fresh.id, amount)
					: await executePayment(paymentProvider, { checkoutId: fresh.id, amount }, gatewayMessages);
			if (!paymentResult.ok) {
				await operation?.remove();
				throw new Error(paymentResult.error);
			}

			await operation?.write<OrderCorrelation>({
				phase: "order_created",
				orderId: paymentResult.orderId,
			});
			if (sessionStorage.getItem(LOST_RESPONSE_FAULT) === "armed") {
				sessionStorage.removeItem(LOST_RESPONSE_FAULT);
				onFaultConsumed();
				throw new Error("Injected lost response after Saleor committed the order.");
			}

			const proof = await getSignetOrderProof(paymentResult.orderId);
			if (!proof) throw new Error("The order response arrived but authoritative verification failed.");
			return { ...proof, status: "placed" };
		},
		recover: async ({ operation }) => {
			const correlation = await operation?.read<OrderCorrelation>();
			if (!correlation) return { recovered: false };
			if (correlation.phase === "payment_started") {
				return {
					recovered: false,
					outcome: "unknown",
					reason: "Payment started, but no Saleor order ID was recorded.",
				};
			}
			const proof = await getSignetOrderProof(correlation.orderId);
			return proof
				? { recovered: true, output: { ...proof, status: "placed" } }
				: {
						recovered: false,
						outcome: "unknown",
						reason: "The correlated Saleor order could not be verified.",
					};
		},
		verify: async ({ input, output, context }) => {
			const proof = await getSignetOrderProof(output.orderId);
			return (
				proof?.isPaid === true &&
				proof.email === context.email &&
				proof.lineCount === context.lineCount &&
				proof.currency === input.expectedCurrency &&
				nearlyEqual(proof.totalAmount, input.expectedTotalAmount)
			);
		},
		outputBudgetBytes: 2048,
	};

	return { inspect, contact, deliveryOptions, delivery, placeOrder };
}

function requireActiveCheckout({ context }: { context: CheckoutContext }) {
	return {
		allowed: context.checkoutId !== null,
		reason: "No active checkout is available to update.",
	};
}

function placeOrderKey({ input, context }: { input: PlaceOrderInput; context: CheckoutContext }) {
	return `${context.checkoutId}:${input.operationId}:place:${input.expectedCurrency}:${input.expectedTotalAmount.toFixed(2)}`;
}

async function refreshAndAdopt(
	refreshCheckout: CheckoutDataContextValue["refreshCheckout"],
	setCheckout: CheckoutDataContextValue["setCheckout"],
): Promise<CheckoutContext> {
	const fresh = await refreshCheckout();
	if (!fresh) throw new Error("Saleor did not return the updated checkout.");
	setCheckout(fresh);
	return checkoutContext(fresh);
}
