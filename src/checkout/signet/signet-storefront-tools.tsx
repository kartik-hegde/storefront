"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCheckoutPath } from "@paper/session-bridge";
import { createSignett, type SignettTool } from "signett";
import { useSignettActivity, useSignettTool } from "signett/react";

import {
	prepareSignettDemoCheckout,
	verifySignettDemoCheckout,
} from "@/app/(storefront)/signett-demo-actions";

type Props = { channel: string; locale: string };
type BootstrapOutput = {
	checkoutId: string;
	checkoutUrl: string;
	productName: string;
	quantity: number;
	variantId: string;
};

export function SignettStorefrontTools({ channel, locale }: Props) {
	const [pendingUrl, setPendingUrl] = useState<string | null>(null);
	const signett = useMemo(() => createSignett({ unsupported: "warn" }), []);
	const tool = useMemo<SignettTool<Record<string, never>, BootstrapOutput, undefined>>(
		() => ({
			name: "start_saleor_checkout_demo",
			title: "Start the Saleor checkout demo",
			description:
				"Prepare a real Saleor checkout with one inexpensive in-stock product, verify the cart through Saleor, and open the checkout where five guarded checkout tools become available. Repeating this call reuses a non-empty cart instead of adding a duplicate item.",
			inputSchema: { type: "object", properties: {}, additionalProperties: false },
			annotations: { readOnlyHint: false },
			execute: async () => {
				const result = await prepareSignettDemoCheckout(channel, locale);
				if (!result.ok) throw new Error(result.error);

				const checkoutUrl = buildCheckoutPath({
					checkoutId: result.checkoutId,
					step: "contact",
					browseLocale: locale,
				});
				setPendingUrl(checkoutUrl);
				return { ...result, checkoutUrl };
			},
			verify: ({ output }) => verifySignettDemoCheckout(output.checkoutId, output.variantId),
		}),
		[channel, locale],
	);
	const registration = useSignettTool(signett, tool, [tool]);
	const activity = useSignettActivity(signett, { toolName: tool.name, maxInvocations: 1 });

	useEffect(() => {
		if (activity.latest?.phase === "succeeded" && activity.latest.verified && pendingUrl) {
			window.location.assign(pendingUrl);
		}
	}, [activity.latest, pendingUrl]);

	if (process.env.NEXT_PUBLIC_SIGNETT_DEMO !== "true") return null;

	return (
		<div className="fixed bottom-4 right-4 z-40 rounded-full border border-border bg-card px-3 py-2 text-xs shadow-overlay">
			<span className="font-semibold">Signett ready</span>
			<span className="ml-2 text-muted-foreground">
				{registration.status === "registered" ? "1 start tool" : "registering…"}
			</span>
		</div>
	);
}
