import { beforeEach, describe, expect, it, vi } from "vitest";

const checkoutMocks = vi.hoisted(() => ({
	find: vi.fn(),
	findOrCreate: vi.fn(),
	getIdFromCookies: vi.fn(),
	saveIdToCookie: vi.fn(),
}));
const graphqlMocks = vi.hoisted(() => ({
	executeAuthenticatedGraphQL: vi.fn(),
	executePublicGraphQL: vi.fn(),
}));

vi.mock("@/lib/checkout", () => checkoutMocks);
vi.mock("@/lib/graphql", () => graphqlMocks);
vi.mock("@/lib/graphql-locale", () => ({ graphqlLanguageCodeVariables: () => ({ languageCode: "EN" }) }));

import { addSignettCartItem, searchSignettProducts, verifySignettCartItem } from "./signett-demo-actions";

const liveVariant = {
	id: "variant-1",
	quantityAvailable: 5,
	pricing: { price: { gross: { amount: 1.99, currency: "USD" } } },
};

describe("Signett storefront actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		checkoutMocks.getIdFromCookies.mockResolvedValue("checkout-1");
		graphqlMocks.executePublicGraphQL.mockResolvedValue({
			ok: true,
			data: { productVariant: liveVariant },
		});
	});

	it("does not increment a variant that is already in the cart", async () => {
		checkoutMocks.find.mockResolvedValue({
			id: "checkout-1",
			lines: [{ quantity: 1, variant: { id: "variant-1" } }],
		});

		await expect(addSignettCartItem("default", "en", "variant-1", 1.99, "USD")).resolves.toEqual({
			ok: true,
			checkoutId: "checkout-1",
			variantId: "variant-1",
			quantity: 1,
			status: "already_present",
		});
		expect(graphqlMocks.executeAuthenticatedGraphQL).not.toHaveBeenCalled();
	});

	it("rejects a stale price before mutating the cart", async () => {
		await expect(addSignettCartItem("default", "en", "variant-1", 2.49, "USD")).resolves.toEqual({
			ok: false,
			error: "The Saleor price changed; search again before changing the cart.",
		});
		expect(graphqlMocks.executeAuthenticatedGraphQL).not.toHaveBeenCalled();
	});

	it("verifies the cart line from authoritative checkout state", async () => {
		checkoutMocks.find.mockResolvedValue({
			lines: [{ quantity: 1, variant: { id: "variant-1" } }],
		});
		await expect(verifySignettCartItem("checkout-1", "variant-1")).resolves.toBe(true);
	});

	it("sorts live search results by price and applies the maximum", async () => {
		graphqlMocks.executePublicGraphQL.mockResolvedValue({
			ok: true,
			data: {
				products: {
					edges: [
						{
							node: {
								name: "Expensive",
								slug: "expensive",
								productVariants: {
									edges: [
										{
											node: {
												id: "v2",
												name: "V2",
												quantityAvailable: 2,
												pricing: { price: { gross: { amount: 9, currency: "USD" } } },
											},
										},
									],
								},
							},
						},
						{
							node: {
								name: "Juice",
								slug: "juice",
								productVariants: {
									edges: [
										{
											node: {
												id: "v1",
												name: "V1",
												quantityAvailable: 3,
												pricing: { price: { gross: { amount: 1.99, currency: "USD" } } },
											},
										},
									],
								},
							},
						},
					],
				},
			},
		});

		const result = await searchSignettProducts("default", "juice", 5, 6);
		expect(result).toMatchObject({ ok: true, products: [{ variantId: "v1", unitPrice: 1.99 }] });
	});
});
