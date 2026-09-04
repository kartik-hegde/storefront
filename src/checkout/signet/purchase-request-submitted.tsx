"use client";

import { Check, FileCheck2, RefreshCw, ShieldCheck } from "lucide-react";

import type { ServerCheckout } from "@/checkout/lib/checkout-types";
import { getCheckoutPayAmount, getCheckoutPayCurrency } from "@/checkout/lib/payment/checkout-pay-amount";
import { useCheckoutBrowseLocale } from "@/checkout/providers/checkout-browse";
import { buttonClassName } from "@/ui/components/ui/button";
import { StorefrontHomeLink } from "@/ui/components/shared/storefront-home-link";

type PurchaseRequestSubmittedProps = {
	checkout: ServerCheckout;
	requestId: string;
	isResetting: boolean;
	resetError: string | null;
	onReset(): void;
};

export function PurchaseRequestSubmitted({
	checkout,
	requestId,
	isResetting,
	resetError,
	onReset,
}: PurchaseRequestSubmittedProps) {
	const locale = useCheckoutBrowseLocale();
	const amount = getCheckoutPayAmount(checkout);
	const currency = getCheckoutPayCurrency(checkout);
	const total =
		amount !== null && currency
			? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount)
			: "Unavailable";
	const delivery = checkout.delivery?.shippingMethod?.name ?? "No delivery required";

	return (
		<main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 md:py-14 lg:mr-[30rem] lg:px-8">
			<section className="overflow-hidden rounded-lg border border-border bg-card shadow-elevated">
				<div className="border-b border-border px-6 py-8 text-center md:px-10 md:py-10">
					<span className="mx-auto grid size-14 place-items-center rounded-full bg-success text-primary-foreground">
						<Check className="size-7" aria-hidden />
					</span>
					<p className="mt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
						Verified Saleor effect
					</p>
					<h1 className="mt-2 text-balance text-h1 text-foreground">Purchase request submitted</h1>
					<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
						Signett verified the request against Saleor before updating this screen. No payment was collected;
						the request is ready for merchant review.
					</p>
				</div>

				<div className="grid gap-px bg-border sm:grid-cols-3">
					<div className="bg-card px-5 py-5">
						<p className="text-xs text-muted-foreground">Request</p>
						<p className="mt-1 truncate font-mono text-xs font-medium text-foreground" title={requestId}>
							{requestId}
						</p>
					</div>
					<div className="bg-card px-5 py-5">
						<p className="text-xs text-muted-foreground">Delivery</p>
						<p className="mt-1 text-sm font-medium text-foreground">{delivery}</p>
					</div>
					<div className="bg-card px-5 py-5">
						<p className="text-xs text-muted-foreground">Requested total</p>
						<p className="mt-1 text-sm font-medium text-foreground">{total}</p>
					</div>
				</div>

				<div className="space-y-5 px-6 py-6 md:px-10">
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="flex items-start gap-3">
							<FileCheck2 className="mt-0.5 size-5 text-success" aria-hidden />
							<div>
								<p className="text-sm font-medium text-foreground">Saved in Saleor</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									The durable checkout note contains this request ID.
								</p>
							</div>
						</div>
						<div className="flex items-start gap-3">
							<ShieldCheck className="mt-0.5 size-5 text-success" aria-hidden />
							<div>
								<p className="text-sm font-medium text-foreground">Outcome verified</p>
								<p className="mt-1 text-xs leading-5 text-muted-foreground">
									The UI changed only after Signett read the effect back.
								</p>
							</div>
						</div>
					</div>

					{resetError ? <p className="text-sm text-destructive">{resetError}</p> : null}

					<div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
						<StorefrontHomeLink
							locale={locale}
							channel={checkout.channel.slug}
							className={buttonClassName({ variant: "outline-solid", asLink: true })}
						>
							Continue shopping
						</StorefrontHomeLink>
						<button className={buttonClassName()} disabled={isResetting} onClick={onReset} type="button">
							<RefreshCw className={isResetting ? "size-4 animate-spin" : "size-4"} aria-hidden />
							{isResetting ? "Preparing…" : "Run another demo"}
						</button>
					</div>
				</div>
			</section>
		</main>
	);
}
