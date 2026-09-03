import { ToolError, type IdempotencyStore, type OperationJournal, type SignettTool } from "signett";

import type { CheckoutGatewayMessagesHook } from "@/checkout/hooks/use-checkout-gateway-messages";
import { getCheckoutPayAmount, getCheckoutPayCurrency } from "@/checkout/lib/payment/checkout-pay-amount";
import type { CheckoutDataContextValue } from "@/checkout/providers/checkout-data";

import {
	checkoutContext,
	type CheckoutContext,
	type CheckoutSnapshot,
	type ContactInput,
	type DeliveryInput,
	nearlyEqual,
	type PlaceOrderInput,
	requireCheckout,
	shippingAddressInput,
	toAddressInput,
} from "./checkout-model";
import type { CheckoutOperations, CheckoutOrderProof } from "./checkout-operations";

type OrderResult = CheckoutOrderProof & { status: "placed" };
type OrderCorrelation = { phase: "payment_started" } | { phase: "order_created"; orderId: string };

export type CheckoutToolDependencies = {
	checkoutState: CheckoutSnapshot;
	refreshCheckout: CheckoutDataContextValue["refreshCheckout"];
	setCheckout: CheckoutDataContextValue["setCheckout"];
	gatewayMessages: CheckoutGatewayMessagesHook;
	idempotencyStore: IdempotencyStore;
	operationJournal: OperationJournal;
	operations: CheckoutOperations;
	requestApproval(title: string, detail: string): Promise<boolean>;
	consumeLostResponseFault(): boolean;
	onOrderAttemptFailed?(): void;
	onVerifiedOrder?(proof: CheckoutOrderProof): void;
};

export type CheckoutToolSet = {
	inspect: SignettTool<Record<string, never>, CheckoutContext, CheckoutContext>;
	contact: SignettTool<ContactInput, CheckoutContext, CheckoutContext>;
	deliveryOptions: SignettTool<
		Record<string, never>,
		{ deliveries: Array<Record<string, unknown>> },
		CheckoutContext
	>;
	delivery: SignettTool<DeliveryInput, CheckoutContext, CheckoutContext>;
	placeOrder: SignettTool<PlaceOrderInput, OrderResult, CheckoutContext>;
};

export function createCheckoutTools(dependencies: CheckoutToolDependencies): CheckoutToolSet {
	const {
		checkoutState,
		consumeLostResponseFault,
		gatewayMessages,
		idempotencyStore,
		operationJournal,
		onVerifiedOrder,
		onOrderAttemptFailed,
		operations,
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
			"Set the guest email and shipping address on the active Saleor checkout. Repeating the same values is safe.",
		inputSchema: {
			type: "object",
			properties: {
				email: {
					type: "string",
					minLength: 3,
					maxLength: 254,
					description: "The shopper email address to attach to the guest checkout.",
				},
				firstName: {
					type: "string",
					minLength: 1,
					maxLength: 100,
					description: "The shipping recipient's first name.",
				},
				lastName: {
					type: "string",
					minLength: 1,
					maxLength: 100,
					description: "The shipping recipient's last name.",
				},
				streetAddress1: {
					type: "string",
					minLength: 1,
					maxLength: 200,
					description: "The primary street-address line for shipping.",
				},
				streetAddress2: {
					type: "string",
					maxLength: 200,
					description: "An optional apartment, suite, unit, or secondary address line.",
				},
				city: {
					type: "string",
					minLength: 1,
					maxLength: 100,
					description: "The shipping city or locality.",
				},
				countryArea: {
					type: "string",
					minLength: 1,
					maxLength: 100,
					description: "The shipping state, province, or region.",
				},
				postalCode: {
					type: "string",
					minLength: 1,
					maxLength: 32,
					description: "The shipping postal or ZIP code.",
				},
				countryCode: {
					type: "string",
					minLength: 2,
					maxLength: 2,
					pattern: "^[A-Z]{2}$",
					description: "The two-letter uppercase ISO 3166-1 shipping country code.",
				},
				phone: {
					type: "string",
					maxLength: 32,
					description: "An optional recipient phone number including country code.",
				},
			},
			required: [
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
		execute: async (input) => {
			const active = requireCheckout(checkoutState.read());
			const emailResult = await operations.updateEmail(active.id, input.email);
			if (!emailResult.ok) throw new Error(emailResult.error ?? "Saleor rejected the checkout email.");

			const addressResult = await operations.updateShippingAddress(active.id, toAddressInput(input), false);
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
			const result = await operations.calculateDeliveryOptions(active.id);
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
				deliveryId: {
					type: "string",
					minLength: 1,
					maxLength: 512,
					description: "A delivery ID returned by list_delivery_options for the active checkout.",
				},
			},
			required: ["deliveryId"],
			additionalProperties: false,
		},
		authorize: requireActiveCheckout,
		execute: async ({ deliveryId }) => {
			const active = requireCheckout(checkoutState.read());
			const result = await operations.updateDeliveryMethod(active.id, deliveryId);
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
				operationId: {
					type: "string",
					minLength: 8,
					maxLength: 64,
					description: "A stable unique ID for this exact order-placement intent; reuse it only for retries.",
				},
				expectedTotalAmount: {
					type: "number",
					minimum: 0,
					description: "The exact checkout total observed from inspect_checkout before requesting approval.",
				},
				expectedCurrency: {
					type: "string",
					minLength: 3,
					maxLength: 3,
					pattern: "^[A-Z]{3}$",
					description: "The three-letter uppercase currency code observed from inspect_checkout.",
				},
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
			let responseLossTriggered = false;
			try {
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

				const billingResult = await operations.updateBillingAddress({
					checkoutId: active.id,
					billingAddress,
					saveAddress: false,
				});
				if (!billingResult.ok) {
					throw new Error(billingResult.error ?? "Saleor rejected the billing address.");
				}

				const paymentProvider = operations.resolvePaymentProvider(fresh.availablePaymentGateways);
				await operation?.write<OrderCorrelation>({ phase: "payment_started" });
				const paymentResult =
					paymentProvider.type === "dummy" && paymentProvider.gateway.id === "mirumee.payments.dummy"
						? await operations.executeLegacyDummyPayment(fresh.id, amount)
						: await operations.executePayment(
								paymentProvider,
								{ checkoutId: fresh.id, amount },
								gatewayMessages,
							);
				if (!paymentResult.ok) {
					await operation?.remove();
					throw new ToolError({
						code: "payment_provider_unavailable",
						message: paymentResult.error,
						retry: "after_repair",
						repair: {
							action: "stop",
							instruction:
								"The Saleor payment provider rejected this attempt. Do not retry or request approval again until the provider is healthy.",
						},
					});
				}

				await operation?.write<OrderCorrelation>({
					phase: "order_created",
					orderId: paymentResult.orderId,
				});
				if (consumeLostResponseFault()) {
					responseLossTriggered = true;
					throw new Error("Injected lost response after Saleor committed the order.");
				}

				const proof = await operations.getOrderProof(paymentResult.orderId);
				if (!proof) throw new Error("The order response arrived but authoritative verification failed.");
				return { ...proof, status: "placed" };
			} catch (error) {
				if (!responseLossTriggered) onOrderAttemptFailed?.();
				throw error;
			}
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
			const proof = await operations.getOrderProof(correlation.orderId);
			return proof
				? { recovered: true, output: { ...proof, status: "placed" } }
				: {
						recovered: false,
						outcome: "unknown",
						reason: "The correlated Saleor order could not be verified.",
					};
		},
		verify: async ({ input, output, context }) => {
			const proof = await operations.getOrderProof(output.orderId);
			const verified =
				proof?.isPaid === true &&
				proof.email === context.email &&
				proof.lineCount === context.lineCount &&
				proof.currency === input.expectedCurrency &&
				nearlyEqual(proof.totalAmount, input.expectedTotalAmount);
			if (verified && proof) onVerifiedOrder?.(proof);
			return verified;
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
