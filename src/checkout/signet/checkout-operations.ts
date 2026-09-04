import {
	calculateDeliveryOptions,
	updateCheckoutCustomerNote,
	updateCheckoutDeliveryMethod,
	updateCheckoutEmail,
	updateCheckoutShippingAddress,
} from "@/app/(checkout)/actions";

/** The real Saleor boundary, injected so the WebMCP tools remain deterministic to test. */
export const checkoutOperations = {
	calculateDeliveryOptions,
	updateCustomerNote: updateCheckoutCustomerNote,
	updateDeliveryMethod: updateCheckoutDeliveryMethod,
	updateEmail: updateCheckoutEmail,
	updateShippingAddress: updateCheckoutShippingAddress,
};

export type CheckoutOperations = typeof checkoutOperations;

export type CheckoutRequestProof = {
	checkoutId: string;
	requestId: string;
	email: string;
	lineCount: number;
	totalAmount: number;
	currency: string;
	deliveryName: string;
};
