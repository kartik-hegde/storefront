"use server";

import { CheckoutAddLineDocument, ProductVariantsForPdpDocument } from "@/gql/graphql";
import * as Checkout from "@/lib/checkout";
import { graphqlLanguageCodeVariables } from "@/lib/graphql-locale";
import { executeAuthenticatedGraphQL, executePublicGraphQL } from "@/lib/graphql";

const DEMO_PRODUCT_SLUG = "carrot-juice";

export type PreparedSignettCheckout = {
	ok: true;
	checkoutId: string;
	productName: string;
	quantity: number;
	variantId: string;
};

type PrepareFailure = { ok: false; error: string };

/**
 * Give the catalog-level WebMCP bootstrap tool a real Saleor checkout.
 * Reuse a non-empty cart when one exists so refreshing or repeating the tool
 * does not silently add another line.
 */
export async function prepareSignettDemoCheckout(
	channel: string,
	locale: string,
): Promise<PreparedSignettCheckout | PrepareFailure> {
	const currentId = await Checkout.getIdFromCookies(channel);
	const current = await Checkout.find(currentId, locale);
	const currentLine = current?.lines[0];

	if (current && currentLine) {
		return {
			ok: true,
			checkoutId: current.id,
			productName: currentLine.variant.product.name,
			quantity: currentLine.quantity,
			variantId: currentLine.variant.id,
		};
	}

	const productResult = await executePublicGraphQL(ProductVariantsForPdpDocument, {
		variables: {
			slug: DEMO_PRODUCT_SLUG,
			channel,
			first: 10,
			after: null,
			...graphqlLanguageCodeVariables(locale),
		},
		cache: "no-cache",
	});

	if (!productResult.ok) {
		return { ok: false, error: "Saleor could not load the demo product." };
	}

	const variant = productResult.data.product?.productVariants?.edges
		.map(({ node }) => node)
		.find((candidate) => (candidate.quantityAvailable ?? 0) > 0 && candidate.pricing?.price?.gross);
	if (!variant) {
		return { ok: false, error: "No in-stock demo product variant is available." };
	}

	const checkout = await Checkout.findOrCreate({ channel, checkoutId: currentId, localeSlug: locale });
	if (!checkout) {
		return { ok: false, error: "Saleor could not create the demo checkout." };
	}

	await Checkout.saveIdToCookie(channel, checkout.id);
	const addResult = await executeAuthenticatedGraphQL(CheckoutAddLineDocument, {
		variables: { id: checkout.id, productVariantId: variant.id },
		cache: "no-cache",
	});

	if (!addResult.ok) {
		return { ok: false, error: "Saleor could not add the demo product." };
	}

	const payload = addResult.data.checkoutLinesAdd;
	if (!payload?.checkout || payload.errors.length > 0) {
		return { ok: false, error: payload?.errors[0]?.message ?? "Saleor rejected the demo cart update." };
	}

	const addedLine = payload.checkout.lines[0];
	return {
		ok: true,
		checkoutId: payload.checkout.id,
		productName: addedLine?.variant.product.name ?? "Carrot Juice",
		quantity: addedLine?.quantity ?? 1,
		variantId: variant.id,
	};
}

/** Authoritative postcondition for the bootstrap tool. */
export async function verifySignettDemoCheckout(checkoutId: string, variantId: string): Promise<boolean> {
	const checkout = await Checkout.find(checkoutId);
	return Boolean(checkout?.lines.some((line) => line.variant.id === variantId && line.quantity > 0));
}
