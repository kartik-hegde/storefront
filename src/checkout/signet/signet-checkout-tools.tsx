"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSignet, type GuardEvent, WebStorageOperationJournal } from "@signet/webmcp";
import { useSignetTool } from "@signet/webmcp/react";
import { IndexedDbIdempotencyStore } from "@signet/webmcp/stores";

import { useCheckoutGatewayMessages } from "@/checkout/hooks/use-checkout-gateway-messages";
import { useCheckoutData } from "@/checkout/providers/checkout-data";

import { CheckoutSnapshot, checkoutContext, LOST_RESPONSE_FAULT } from "./checkout-model";
import { checkoutOperations } from "./checkout-operations";
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

	const idempotencyStore = useMemo(() => new IndexedDbIdempotencyStore(), []);
	const operationJournal = useMemo(
		() =>
			new WebStorageOperationJournal(
				{
					getItem: (key) => sessionStorage.getItem(key),
					setItem: (key, value) => sessionStorage.setItem(key, value),
					removeItem: (key) => sessionStorage.removeItem(key),
				},
				"saleor-signet:operation:",
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

	const signet = useMemo(
		() =>
			createSignet({
				context: readContext,
				observe,
				unsupported: "warn",
			}),
		[observe, readContext],
	);

	const requestApproval = useCallback((title: string, detail: string): Promise<boolean> => {
		if (process.env.NEXT_PUBLIC_SIGNET_AUTO_CONFIRM === "true") return Promise.resolve(true);
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
		useSignetTool(signet, tools.inspect, [tools.inspect]),
		useSignetTool(signet, tools.contact, [tools.contact]),
		useSignetTool(signet, tools.deliveryOptions, [tools.deliveryOptions]),
		useSignetTool(signet, tools.delivery, [tools.delivery]),
		useSignetTool(signet, tools.placeOrder, [tools.placeOrder]),
	];

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

	if (process.env.NEXT_PUBLIC_SIGNET_DEMO !== "true") return null;

	return (
		<SignetDemoPanel
			approval={approval}
			events={events}
			faultArmed={faultArmed}
			proof={proof}
			registeredCount={registrations.filter(({ status }) => status === "registered").length}
			onArmFault={armFault}
			onApproval={decideApproval}
		/>
	);
}
