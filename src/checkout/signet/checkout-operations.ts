import {
	calculateDeliveryOptions,
	executeSignetLegacyDummyPayment,
	getSignetOrderProof,
	updateCheckoutBillingAddress,
	updateCheckoutDeliveryMethod,
	updateCheckoutEmail,
	updateCheckoutShippingAddress,
} from "@/app/(checkout)/actions";
import { executePayment, resolvePaymentProvider } from "@/checkout/lib/payment";

/** The real Saleor boundary, injected so the WebMCP tools remain deterministic to test. */
export const checkoutOperations = {
	calculateDeliveryOptions,
	executeLegacyDummyPayment: executeSignetLegacyDummyPayment,
	executePayment,
	getOrderProof: getSignetOrderProof,
	resolvePaymentProvider,
	updateBillingAddress: updateCheckoutBillingAddress,
	updateDeliveryMethod: updateCheckoutDeliveryMethod,
	updateEmail: updateCheckoutEmail,
	updateShippingAddress: updateCheckoutShippingAddress,
};

export type CheckoutOperations = typeof checkoutOperations;
export type CheckoutOrderProof = NonNullable<Awaited<ReturnType<typeof getSignetOrderProof>>>;
