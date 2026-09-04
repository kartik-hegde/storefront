import { type ReactNode } from "react";
import { CheckoutHeader } from "./checkout-header";

type CheckoutPageShellProps = {
	children: ReactNode;
	/** Checkout progress step for the header. Omit to hide the step indicator row context. */
	step?: number;
	onStepClick?: (step: number) => void;
	isShippingRequired?: boolean;
	completionLabel?: string;
	/** When set, header logo hard-navigates to `/{locale}/{channel}` (avoids stale storefront Router Cache). */
	storefrontChannel?: string | null;
};

/** Shared checkout surface layout — one header + page chrome for all checkout states. */
export function CheckoutPageShell({
	children,
	step = 1,
	onStepClick,
	isShippingRequired = true,
	completionLabel,
	storefrontChannel,
}: CheckoutPageShellProps) {
	return (
		<div className="min-h-screen overscroll-none bg-secondary">
			<CheckoutHeader
				step={step}
				completionLabel={completionLabel}
				onStepClick={onStepClick}
				isShippingRequired={isShippingRequired}
				storefrontChannel={storefrontChannel}
			/>
			{children}
		</div>
	);
}
