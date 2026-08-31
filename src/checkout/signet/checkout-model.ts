import type { AddressInput, CountryCode } from "@/checkout/graphql/generated/operations";
import type { ServerCheckout } from "@/checkout/lib/checkout-types";
import { getCheckoutPayAmount, getCheckoutPayCurrency } from "@/checkout/lib/payment/checkout-pay-amount";

export const LOST_RESPONSE_FAULT = "saleor-signet:fault:lost-response";

export type CheckoutContext = {
	checkoutId: string | null;
	channel: string | null;
	email: string | null;
	lineCount: number;
	totalAmount: number | null;
	currency: string | null;
};

export type ContactInput = {
	operationId: string;
	email: string;
	firstName: string;
	lastName: string;
	streetAddress1: string;
	streetAddress2?: string;
	city: string;
	countryArea: string;
	postalCode: string;
	countryCode: string;
	phone?: string;
};

export type DeliveryInput = {
	operationId: string;
	deliveryId: string;
};

export type PlaceOrderInput = {
	operationId: string;
	expectedTotalAmount: number;
	expectedCurrency: string;
};

export class CheckoutSnapshot {
	#checkout: ServerCheckout | null = null;

	update(checkout: ServerCheckout | null): void {
		this.#checkout = checkout;
	}

	read(): ServerCheckout | null {
		return this.#checkout;
	}
}

export function checkoutContext(checkout: ServerCheckout | null): CheckoutContext {
	return {
		checkoutId: checkout?.id ?? null,
		channel: checkout?.channel.slug ?? null,
		email: checkout?.email ?? null,
		lineCount: checkout?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0,
		totalAmount: checkout ? getCheckoutPayAmount(checkout) : null,
		currency: checkout ? getCheckoutPayCurrency(checkout) : null,
	};
}

export function requireCheckout(checkout: ServerCheckout | null): ServerCheckout {
	if (!checkout) throw new Error("There is no active Saleor checkout on this page.");
	return checkout;
}

export function toAddressInput(input: ContactInput): AddressInput {
	return {
		firstName: input.firstName,
		lastName: input.lastName,
		streetAddress1: input.streetAddress1,
		streetAddress2: input.streetAddress2 ?? "",
		city: input.city,
		countryArea: input.countryArea,
		postalCode: input.postalCode,
		country: input.countryCode as CountryCode,
		phone: input.phone ?? "",
	};
}

export function shippingAddressInput(checkout: ServerCheckout): AddressInput | null {
	const address = checkout.shippingAddress;
	if (!address) return null;
	return {
		firstName: address.firstName,
		lastName: address.lastName,
		companyName: address.companyName,
		streetAddress1: address.streetAddress1,
		streetAddress2: address.streetAddress2,
		city: address.city,
		cityArea: address.cityArea,
		countryArea: address.countryArea,
		postalCode: address.postalCode,
		country: address.country.code as CountryCode,
		phone: address.phone,
	};
}

export function nearlyEqual(left: number, right: number): boolean {
	return Math.abs(left - right) < 0.005;
}
