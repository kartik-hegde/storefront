"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSignett, type GuardEvent, WebStorageOperationJournal } from "signett";
import { useSignettActivity, useSignettTool } from "signett/react";
import { IndexedDbIdempotencyStore } from "signett/stores";

import { useCheckoutGatewayMessages } from "@/checkout/hooks/use-checkout-gateway-messages";
import { navigateToOrderConfirmation } from "@/checkout/lib/payment/navigate-to-order";
import { useCheckoutData } from "@/checkout/providers/checkout-data";

import { CheckoutSnapshot, checkoutContext, LOST_RESPONSE_FAULT } from "./checkout-model";
import { checkoutOperations, type CheckoutOrderProof } from "./checkout-operations";
import { createCheckoutTools } from "./checkout-tools";
import { type ApprovalRequest, SignetDemoPanel } from "./signet-demo-panel";

export function SignetCheckoutTools() {
	const { checkout, refreshCheckout, setCheckout } = useCheckoutData();
	const gatewayMessages = useCheckoutGatewayMessages();
	const checkoutState = useMemo(() => new CheckoutSnapshot(), []);
	useEffect(() => checkoutState.update(checkout), [checkout, checkoutState]);

	const [events, setEvents] = useState<GuardEvent[]>([]);
	const [proof, setProof] = useState({ recovered: false, replayed: false });
	const [approval, setApproval] = useState<ApprovalRequest | null>(null);
	const [faultArmed, setFaultArmed] = useState(false);
	const [verifiedOrder, setVerifiedOrder] = useState<CheckoutOrderProof | null>(null);

	const idempotencyStore = useMemo(() => new IndexedDbIdempotencyStore(), []);
	const operationJournal = useMemo(
		() =>
			new WebStorageOperationJournal(
				{
					getItem: (key) => sessionStorage.getItem(key),
					setItem: (key, value) => sessionStorage.setItem(key, value),
					removeItem: (key) => sessionStorage.removeItem(key),
				},
				"saleor-signett:operation:",
			),
		[],
	);
	const readContext = useCallback(() => checkoutContext(checkoutState.read()), [checkoutState]);
	const observe = useCallback((event: GuardEvent) => {
		setEvents((current) => [event, ...current].slice(0, 12));
		if (event.stage === "recovered") {
			setProof((current) => ({ ...current, recovered: true }));
		}
		if (event.stage === "replayed") {
			setProof((current) => ({ ...current, replayed: true }));
		}
	}, []);

	const signett = useMemo(
		() =>
			createSignett({
				context: readContext,
				observe,
				unsupported: "warn",
			}),
		[observe, readContext],
	);

	const requestApproval = useCallback((title: string, detail: string): Promise<boolean> => {
		if (process.env.NEXT_PUBLIC_SIGNETT_AUTO_CONFIRM === "true") return Promise.resolve(true);
		return new Promise<boolean>((resolve) => setApproval({ title, detail, resolve }));
	}, []);

	const tools = useMemo(
		() =>
			createCheckoutTools({
				checkoutState,
				consumeLostResponseFault: () => {
					if (sessionStorage.getItem(LOST_RESPONSE_FAULT) !== "armed") return false;
					sessionStorage.removeItem(LOST_RESPONSE_FAULT);
					setFaultArmed(false);
					return true;
				},
				refreshCheckout,
				setCheckout,
				gatewayMessages,
				idempotencyStore,
				operationJournal,
				onVerifiedOrder: setVerifiedOrder,
				operations: checkoutOperations,
				requestApproval,
			}),
		[
			checkoutState,
			gatewayMessages,
			idempotencyStore,
			operationJournal,
			refreshCheckout,
			requestApproval,
			setCheckout,
		],
	);

	const registrations = [
		useSignettTool(signett, tools.inspect, [tools.inspect]),
		useSignettTool(signett, tools.contact, [tools.contact]),
		useSignettTool(signett, tools.deliveryOptions, [tools.deliveryOptions]),
		useSignettTool(signett, tools.delivery, [tools.delivery]),
		useSignettTool(signett, tools.placeOrder, [tools.placeOrder]),
	];
	const orderActivity = useSignettActivity(signett, { toolName: "place_order", maxInvocations: 5 });

	const decideApproval = useCallback((confirmed: boolean) => {
		setApproval((current) => {
			current?.resolve(confirmed);
			return null;
		});
	}, []);

	const armFault = useCallback(() => {
		sessionStorage.setItem(LOST_RESPONSE_FAULT, "armed");
		setFaultArmed(true);
	}, []);

	if (process.env.NEXT_PUBLIC_SIGNETT_DEMO !== "true") return null;

	return (
		<SignetDemoPanel
			approval={approval}
			activity={orderActivity.latest}
			events={events}
			faultArmed={faultArmed}
			proof={proof}
			registeredCount={registrations.filter(({ status }) => status === "registered").length}
			verifiedOrder={verifiedOrder}
			onArmFault={armFault}
			onApproval={decideApproval}
			onViewOrder={() => {
				if (verifiedOrder) navigateToOrderConfirmation(verifiedOrder.orderId);
			}}
		/>
	);
}
