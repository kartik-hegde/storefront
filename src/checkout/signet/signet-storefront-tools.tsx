"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCheckoutPath } from "@paper/session-bridge";
import { createSignett, type SignettTool } from "signett";
import { useSignettActivity, useSignettTool } from "signett/react";

import {
	addSignettCartItem,
	inspectSignettCart,
	searchSignettProducts,
	verifySignettCartItem,
	type SignettCartSnapshot,
	type SignettCatalogProduct,
} from "@/app/(storefront)/signett-demo-actions";

type Props = { channel: string; locale: string };
type SearchInput = { query?: string; maxPrice?: number; limit?: number };
type AddInput = { variantId: string; expectedUnitPrice: number; expectedCurrency: string };
type CheckoutOutput = { checkoutId: string; checkoutUrl: string; lineCount: number };

export function SignettStorefrontTools({ channel, locale }: Props) {
	const [pendingUrl, setPendingUrl] = useState<string | null>(null);
	const signett = useMemo(() => createSignett({ unsupported: "warn" }), []);

	const searchTool = useMemo<SignettTool<SearchInput, { products: SignettCatalogProduct[] }, undefined>>(
		() => ({
			name: "search_products",
			title: "Search Saleor products",
			description:
				"Search the live Saleor catalog for in-stock variants. Returns exact variant IDs and current prices needed by add_to_cart.",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", maxLength: 100, description: "Product words, such as juice or shoes." },
					maxPrice: { type: "number", minimum: 0, description: "Optional maximum unit price." },
					limit: { type: "integer", minimum: 1, maximum: 12, default: 6 },
				},
				additionalProperties: false,
			},
			annotations: { readOnlyHint: true },
			execute: async (input) => {
				const result = await searchSignettProducts(
					channel,
					input.query ?? "",
					input.maxPrice,
					input.limit ?? 6,
				);
				if (!result.ok) throw new Error(result.error);
				return { products: result.products };
			},
		}),
		[channel],
	);

	const inspectTool = useMemo<SignettTool<Record<string, never>, SignettCartSnapshot, undefined>>(
		() => ({
			name: "inspect_cart",
			title: "Inspect Saleor cart",
			description:
				"Read the current Saleor cart, including exact lines, quantities, and authoritative total.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
			annotations: { readOnlyHint: true },
			execute: () => inspectSignettCart(channel, locale),
		}),
		[channel, locale],
	);

	const addTool = useMemo<
		SignettTool<
			AddInput,
			{ checkoutId: string; variantId: string; quantity: number; status: "added" | "already_present" },
			undefined
		>
	>(
		() => ({
			name: "add_to_cart",
			title: "Add a verified item to cart",
			description:
				"Ensure one searched Saleor variant is in the cart. Supply the exact price returned by search_products. Repeating the same call does not increment an existing line.",
			inputSchema: {
				type: "object",
				properties: {
					variantId: {
						type: "string",
						minLength: 1,
						description: "Exact Saleor variant ID from search_products.",
					},
					expectedUnitPrice: {
						type: "number",
						minimum: 0,
						description: "Exact unit price from search_products.",
					},
					expectedCurrency: {
						type: "string",
						pattern: "^[A-Z]{3}$",
						description: "Three-letter currency from search_products.",
					},
				},
				required: ["variantId", "expectedUnitPrice", "expectedCurrency"],
				additionalProperties: false,
			},
			annotations: { readOnlyHint: false },
			execute: async (input) => {
				const result = await addSignettCartItem(
					channel,
					locale,
					input.variantId,
					input.expectedUnitPrice,
					input.expectedCurrency,
				);
				if (!result.ok) throw new Error(result.error);
				return result;
			},
			verify: ({ output }) => verifySignettCartItem(output.checkoutId, output.variantId),
		}),
		[channel, locale],
	);

	const checkoutTool = useMemo<SignettTool<Record<string, never>, CheckoutOutput, undefined>>(
		() => ({
			name: "begin_checkout",
			title: "Begin checkout",
			description:
				"Verify that the Saleor cart is non-empty and open checkout. The page will then expose five checkout-specific tools.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
			annotations: { readOnlyHint: true },
			execute: async () => {
				const cart = await inspectSignettCart(channel, locale);
				if (!cart.checkoutId || cart.lineCount < 1) throw new Error("Add an item before beginning checkout.");
				const checkoutUrl = buildCheckoutPath({
					checkoutId: cart.checkoutId,
					step: "contact",
					browseLocale: locale,
				});
				setPendingUrl(checkoutUrl);
				return { checkoutId: cart.checkoutId, checkoutUrl, lineCount: cart.lineCount };
			},
			verify: async ({ output }) => {
				const cart = await inspectSignettCart(channel, locale);
				return cart.checkoutId === output.checkoutId && cart.lineCount > 0;
			},
		}),
		[channel, locale],
	);

	const registrations = [
		useSignettTool(signett, searchTool, [searchTool]),
		useSignettTool(signett, inspectTool, [inspectTool]),
		useSignettTool(signett, addTool, [addTool]),
		useSignettTool(signett, checkoutTool, [checkoutTool]),
	];
	const checkoutActivity = useSignettActivity(signett, { toolName: checkoutTool.name, maxInvocations: 1 });

	useEffect(() => {
		if (checkoutActivity.latest?.phase === "succeeded" && checkoutActivity.latest.verified && pendingUrl) {
			window.location.assign(pendingUrl);
		}
	}, [checkoutActivity.latest, pendingUrl]);

	if (process.env.NEXT_PUBLIC_SIGNETT_DEMO !== "true") return null;

	const registeredCount = registrations.filter(({ status }) => status === "registered").length;
	return (
		<div className="fixed bottom-4 right-4 z-40 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-overlay">
			<span className="font-semibold">Signett ready</span>
			<span className="ml-2 text-muted-foreground">
				{registeredCount === 4 ? "4 catalog tools" : `registering ${registeredCount}/4…`}
			</span>
		</div>
	);
}
