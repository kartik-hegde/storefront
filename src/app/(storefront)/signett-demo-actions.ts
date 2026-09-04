"use server";

import { CheckoutAddLineDocument, ProductVariantForPdpDocument, TypedDocumentString } from "@/gql/graphql";
import * as Checkout from "@/lib/checkout";
import { graphqlLanguageCodeVariables } from "@/lib/graphql-locale";
import { executeAuthenticatedGraphQL, executePublicGraphQL } from "@/lib/graphql";

type CatalogSearchVariables = { query: string; channel: string; first: number };
type CatalogSearchData = {
	products: {
		edges: Array<{
			node: {
				name: string;
				slug: string;
				productVariants: {
					edges: Array<{
						node: {
							id: string;
							name: string;
							quantityAvailable: number | null;
							pricing: { price: { gross: { amount: number; currency: string } } | null } | null;
						};
					}>;
				};
			};
		}>;
	} | null;
};

const SignettCatalogSearchDocument = new TypedDocumentString<CatalogSearchData, CatalogSearchVariables>(`
  query SignettCatalogSearch($query: String!, $channel: String!, $first: Int!) {
    products(first: $first, channel: $channel, filter: { search: $query }) {
      edges {
        node {
          name
          slug
          productVariants(first: 10) {
            edges {
              node {
                id
                name
                quantityAvailable
                pricing { price { gross { amount currency } } }
              }
            }
          }
        }
      }
    }
  }
`);

export type SignettCatalogProduct = {
	productName: string;
	productSlug: string;
	variantId: string;
	variantName: string;
	unitPrice: number;
	currency: string;
	quantityAvailable: number;
};

export type SignettCartSnapshot = {
	checkoutId: string | null;
	lineCount: number;
	lines: Array<{
		productName: string;
		variantId: string;
		variantName: string;
		quantity: number;
	}>;
	totalAmount: number;
	currency: string | null;
};

type ActionFailure = { ok: false; error: string };

export async function searchSignettProducts(
	channel: string,
	query: string,
	maxPrice: number | undefined,
	limit: number,
): Promise<{ ok: true; products: SignettCatalogProduct[] } | ActionFailure> {
	const result = await executePublicGraphQL(SignettCatalogSearchDocument, {
		variables: { query: query.trim(), channel, first: Math.min(Math.max(limit, 1), 12) },
		cache: "no-cache",
	});

	if (!result.ok) return { ok: false, error: "Saleor could not search the catalog." };

	const products = (result.data.products?.edges ?? [])
		.flatMap(({ node }) =>
			node.productVariants.edges.flatMap(({ node: variant }) => {
				const price = variant.pricing?.price?.gross;
				if (!price || (variant.quantityAvailable ?? 0) < 1) return [];
				return [
					{
						productName: node.name,
						productSlug: node.slug,
						variantId: variant.id,
						variantName: variant.name,
						unitPrice: price.amount,
						currency: price.currency,
						quantityAvailable: variant.quantityAvailable ?? 0,
					},
				];
			}),
		)
		.filter((product) => maxPrice === undefined || product.unitPrice <= maxPrice)
		.sort((left, right) => left.unitPrice - right.unitPrice)
		.slice(0, limit);

	return { ok: true, products };
}

export async function inspectSignettCart(channel: string, locale: string): Promise<SignettCartSnapshot> {
	const checkoutId = await Checkout.getIdFromCookies(channel);
	const checkout = await Checkout.find(checkoutId, locale);
	if (!checkout) {
		return { checkoutId: null, lineCount: 0, lines: [], totalAmount: 0, currency: null };
	}

	return {
		checkoutId: checkout.id,
		lineCount: checkout.lines.reduce((total, line) => total + line.quantity, 0),
		lines: checkout.lines.map((line) => ({
			productName: line.variant.product.name,
			variantId: line.variant.id,
			variantName: line.variant.name,
			quantity: line.quantity,
		})),
		totalAmount: checkout.totalPrice.gross.amount,
		currency: checkout.totalPrice.gross.currency,
	};
}

/** Ensure one selected variant is present without incrementing it on a repeated call. */
export async function addSignettCartItem(
	channel: string,
	locale: string,
	variantId: string,
	expectedUnitPrice: number,
	expectedCurrency: string,
): Promise<
	| {
			ok: true;
			checkoutId: string;
			variantId: string;
			quantity: number;
			status: "added" | "already_present";
	  }
	| ActionFailure
> {
	const variantResult = await executePublicGraphQL(ProductVariantForPdpDocument, {
		variables: { id: variantId, channel, ...graphqlLanguageCodeVariables(locale) },
		cache: "no-cache",
	});
	const variant = variantResult.ok ? variantResult.data.productVariant : null;
	const livePrice = variant?.pricing?.price?.gross;
	if (!variant || (variant.quantityAvailable ?? 0) < 1 || !livePrice) {
		return { ok: false, error: "That Saleor variant is no longer available; search again." };
	}
	if (livePrice.currency !== expectedCurrency || Math.abs(livePrice.amount - expectedUnitPrice) > 0.0001) {
		return { ok: false, error: "The Saleor price changed; search again before changing the cart." };
	}

	const currentId = await Checkout.getIdFromCookies(channel);
	const current = await Checkout.find(currentId, locale);
	const existing = current?.lines.find((line) => line.variant.id === variantId);
	if (current && existing) {
		return {
			ok: true,
			checkoutId: current.id,
			variantId,
			quantity: existing.quantity,
			status: "already_present",
		};
	}

	const checkout = await Checkout.findOrCreate({ channel, checkoutId: currentId, localeSlug: locale });
	if (!checkout) return { ok: false, error: "Saleor could not create the cart." };

	await Checkout.saveIdToCookie(channel, checkout.id);
	const addResult = await executeAuthenticatedGraphQL(CheckoutAddLineDocument, {
		variables: { id: checkout.id, productVariantId: variantId },
		cache: "no-cache",
	});
	if (!addResult.ok) return { ok: false, error: "Saleor could not update the cart." };

	const payload = addResult.data.checkoutLinesAdd;
	if (!payload?.checkout || payload.errors.length > 0) {
		return { ok: false, error: payload?.errors[0]?.message ?? "Saleor rejected the cart update." };
	}

	return { ok: true, checkoutId: payload.checkout.id, variantId, quantity: 1, status: "added" };
}

export async function verifySignettCartItem(checkoutId: string, variantId: string): Promise<boolean> {
	const checkout = await Checkout.find(checkoutId);
	return Boolean(checkout?.lines.some((line) => line.variant.id === variantId && line.quantity > 0));
}
