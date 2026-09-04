import { ToolError, type IdempotencyStore, type OperationJournal, type SignettTool } from "signett";

import type { ServerCheckout } from "@/checkout/lib/checkout-types";
import { getCheckoutPayAmount, getCheckoutPayCurrency } from "@/checkout/lib/payment/checkout-pay-amount";
import type { CheckoutDataContextValue } from "@/checkout/providers/checkout-data";

import {
	checkoutContext,
	type CheckoutContext,
	type CheckoutSnapshot,
	type ContactInput,
	type DeliveryInput,
	nearlyEqual,
	type SubmitRequestInput,
	requireCheckout,
	toAddressInput,
} from "./checkout-model";
import type { CheckoutOperations, CheckoutRequestProof } from "./checkout-operations";

type RequestResult = CheckoutRequestProof & { status: "submitted" };
type RequestCorrelation = {
	phase: "request_started" | "request_submitted";
	checkoutId: string;
	marker: string;
};

export type CheckoutToolDependencies = {
	checkoutState: CheckoutSnapshot;
	refreshCheckout: CheckoutDataContextValue["refreshCheckout"];
	setCheckout: CheckoutDataContextValue["setCheckout"];
	idempotencyStore: IdempotencyStore;
	operationJournal: OperationJournal;
	operations: CheckoutOperations;
	requestApproval(title: string, detail: string): Promise<boolean>;
	consumeLostResponseFault(): boolean;
	onRequestAttemptFailed?(): void;
	onVerifiedRequest?(proof: CheckoutRequestProof): void;
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
	submitRequest: SignettTool<SubmitRequestInput, RequestResult, CheckoutContext>;
};

export function createCheckoutTools(dependencies: CheckoutToolDependencies): CheckoutToolSet {
	const {
		checkoutState,
		consumeLostResponseFault,
		idempotencyStore,
		operationJournal,
		onVerifiedRequest,
		onRequestAttemptFailed,
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

	const submitRequest: CheckoutToolSet["submitRequest"] = {
		name: "submit_purchase_request",
		title: "Submit purchase request",
		description:
			"Submit the active Saleor checkout as a purchase request for merchant review. First inspect the checkout and provide the exact expected total and currency. Generate one stable operationId internally and reuse it for retries; never ask the shopper to provide it. Requires explicit shopper approval.",
		inputSchema: {
			type: "object",
			properties: {
				operationId: {
					type: "string",
					minLength: 8,
					maxLength: 64,
					description: "An agent-generated stable ID for this exact purchase request; reuse it for retries.",
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
					"Submit this purchase request?",
					`${context.lineCount} item${context.lineCount === 1 ? "" : "s"} · ${input.expectedCurrency} ${input.expectedTotalAmount.toFixed(2)} · ${context.email ?? "guest checkout"}`,
				),
		},
		idempotency: {
			store: idempotencyStore,
			key: purchaseRequestKey,
		},
		journal: { store: operationJournal },
		execute: async (input, { operation }) => {
			let responseLossTriggered = false;
			try {
				const fresh = await refreshCheckout({ updateState: false });
				if (!fresh) throw new Error("Saleor could not refresh the checkout before submission.");

				const amount = getCheckoutPayAmount(fresh);
				const currency = getCheckoutPayCurrency(fresh);
				if (amount === null || currency === null) throw new Error("The live Saleor total is unavailable.");
				if (!nearlyEqual(amount, input.expectedTotalAmount) || currency !== input.expectedCurrency) {
					throw new Error(
						`Checkout total changed to ${currency} ${amount.toFixed(2)}; approval is required again.`,
					);
				}

				if (!fresh.email) throw new Error("Set a contact email before submitting the request.");
				if (!fresh.shippingAddress) throw new Error("Set a shipping address before submitting the request.");
				if (!fresh.delivery && fresh.isShippingRequired) {
					throw new Error("Select a delivery option before submitting the request.");
				}

				const marker = purchaseRequestMarker(input.operationId);
				await operation?.write<RequestCorrelation>({
					phase: "request_started",
					checkoutId: fresh.id,
					marker,
				});
				const existingNote = fresh.customerNote.trim();
				const customerNote = existingNote.includes(marker)
					? existingNote
					: [existingNote, marker].filter(Boolean).join("\n\n");
				const result = await operations.updateCustomerNote(fresh.id, customerNote);
				let committedCheckout: ServerCheckout | null = result.ok ? result.checkout : null;
				if (!result.ok) {
					const reconciled = await refreshCheckout({ updateState: false });
					const reconciledProof = reconciled
						? checkoutRequestProof(reconciled, input.operationId, marker)
						: null;
					if (reconciledProof && reconciled) {
						committedCheckout = reconciled;
					} else {
						await operation?.remove();
						throw new ToolError({
							code: "purchase_request_failed",
							message: result.error ?? "Saleor rejected the purchase request.",
							retry: "after_repair",
							repair: {
								action: "refresh_state",
								instruction:
									"Refresh the checkout and reconcile the existing operation before retrying with the same operationId.",
							},
						});
					}
				}
				if (!committedCheckout) throw new Error("Saleor returned no checkout after request submission.");
				setCheckout(committedCheckout);

				await operation?.write<RequestCorrelation>({
					phase: "request_submitted",
					checkoutId: fresh.id,
					marker,
				});
				if (consumeLostResponseFault()) {
					responseLossTriggered = true;
					throw new Error("Injected lost response after Saleor committed the purchase request.");
				}

				const proof = checkoutRequestProof(committedCheckout, input.operationId, marker);
				if (!proof) throw new Error("The request response arrived but authoritative verification failed.");
				return { ...proof, status: "submitted" };
			} catch (error) {
				if (!responseLossTriggered) onRequestAttemptFailed?.();
				throw error;
			}
		},
		recover: async ({ operation }) => {
			const correlation = await operation?.read<RequestCorrelation>();
			if (!correlation) return { recovered: false };
			const fresh = await refreshCheckout({ updateState: false });
			const requestId = correlation.marker.slice("[Signett purchase request ".length, -1);
			const proof = fresh ? checkoutRequestProof(fresh, requestId, correlation.marker) : null;
			if (proof && fresh) setCheckout(fresh);
			return proof
				? { recovered: true, output: { ...proof, status: "submitted" } }
				: {
						recovered: false,
						outcome: "unknown",
						reason: "The correlated Saleor purchase request could not be verified.",
					};
		},
		verify: async ({ input, output, context }) => {
			const fresh = await refreshCheckout({ updateState: false });
			const marker = purchaseRequestMarker(input.operationId);
			const proof = fresh ? checkoutRequestProof(fresh, input.operationId, marker) : null;
			const verified =
				proof?.checkoutId === output.checkoutId &&
				proof.email === context.email &&
				proof.lineCount === context.lineCount &&
				proof.currency === input.expectedCurrency &&
				nearlyEqual(proof.totalAmount, input.expectedTotalAmount);
			if (verified && proof) onVerifiedRequest?.(proof);
			return verified;
		},
		outputBudgetBytes: 2048,
	};

	return { inspect, contact, deliveryOptions, delivery, submitRequest };
}

function requireActiveCheckout({ context }: { context: CheckoutContext }) {
	return {
		allowed: context.checkoutId !== null,
		reason: "No active checkout is available to update.",
	};
}

function purchaseRequestKey({ input, context }: { input: SubmitRequestInput; context: CheckoutContext }) {
	return `${context.checkoutId}:${input.operationId}:request:${input.expectedCurrency}:${input.expectedTotalAmount.toFixed(2)}`;
}

function purchaseRequestMarker(operationId: string): string {
	return `[Signett purchase request ${operationId}]`;
}

function checkoutRequestProof(
	checkout: ServerCheckout,
	requestId: string,
	marker: string,
): CheckoutRequestProof | null {
	if (!checkout.customerNote.includes(marker) || !checkout.email) return null;
	const totalAmount = getCheckoutPayAmount(checkout);
	const currency = getCheckoutPayCurrency(checkout);
	if (totalAmount === null || currency === null) return null;
	return {
		checkoutId: checkout.id,
		requestId,
		email: checkout.email,
		lineCount: checkout.lines.reduce((total, line) => total + line.quantity, 0),
		totalAmount,
		currency,
		deliveryName: checkout.delivery?.shippingMethod?.name ?? "No delivery required",
	};
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
