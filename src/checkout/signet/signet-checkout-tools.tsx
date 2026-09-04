"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createSignett, type GuardEvent, WebStorageOperationJournal } from "signett";
import { TraceAssembler, type InvocationTrace } from "signett/opentelemetry";
import { useSignettActivity, useSignettTool } from "signett/react";
import { IndexedDbIdempotencyStore } from "signett/stores";

import { useCheckoutData } from "@/checkout/providers/checkout-data";

import {
	CheckoutSnapshot,
	checkoutContext,
	LOST_RESPONSE_FAULT,
	ResponseLossSimulation,
	type ResponseLossSimulationState,
} from "./checkout-model";
import { checkoutOperations, type CheckoutRequestProof } from "./checkout-operations";
import { createCheckoutTools } from "./checkout-tools";
import { type ApprovalRequest, SignetDemoPanel } from "./signet-demo-panel";

export function SignetCheckoutTools() {
	const { checkout, refreshCheckout, setCheckout } = useCheckoutData();
	const checkoutState = useMemo(() => new CheckoutSnapshot(), []);
	useEffect(() => checkoutState.update(checkout), [checkout, checkoutState]);

	const [events, setEvents] = useState<GuardEvent[]>([]);
	const [proof, setProof] = useState({ recovered: false, replayed: false });
	const [approval, setApproval] = useState<ApprovalRequest | null>(null);
	const [simulationState, setSimulationState] = useState<ResponseLossSimulationState>("ready");
	const simulation = useMemo(() => new ResponseLossSimulation(), []);
	const [verifiedRequest, setVerifiedRequest] = useState<CheckoutRequestProof | null>(null);
	const [traces, setTraces] = useState<readonly InvocationTrace[]>([]);
	const traceAssembler = useMemo(() => new TraceAssembler({ maxInvocations: 12 }), []);
	const updateSimulationState = useCallback(
		(state: ResponseLossSimulationState) => {
			simulation.update(state);
			setSimulationState(state);
		},
		[simulation],
	);
	useEffect(() => {
		// An armed fault belongs to one visible page run. Do not surprise a later
		// checkout after refresh with a fault from an abandoned attempt.
		sessionStorage.removeItem(LOST_RESPONSE_FAULT);
	}, []);

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
	const observe = useCallback(
		(event: GuardEvent) => {
			const completed = traceAssembler.observe(event);
			if (completed) setTraces(traceAssembler.snapshot());
			setEvents((current) => [event, ...current].slice(0, 12));
			if (event.stage === "recovered") {
				setProof((current) => ({ ...current, recovered: true }));
				if (simulation.read() === "triggered") updateSimulationState("recovered");
			}
			if (event.stage === "replayed") {
				setProof((current) => ({ ...current, replayed: true }));
				if (simulation.read() === "triggered") updateSimulationState("recovered");
			}
		},
		[simulation, traceAssembler, updateSimulationState],
	);

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
					updateSimulationState("triggered");
					return true;
				},
				onRequestAttemptFailed: () => {
					if (simulation.read() !== "armed") return;
					sessionStorage.removeItem(LOST_RESPONSE_FAULT);
					updateSimulationState("ready");
				},
				refreshCheckout,
				setCheckout,
				idempotencyStore,
				operationJournal,
				onVerifiedRequest: setVerifiedRequest,
				operations: checkoutOperations,
				requestApproval,
			}),
		[
			checkoutState,
			idempotencyStore,
			operationJournal,
			refreshCheckout,
			requestApproval,
			setCheckout,
			simulation,
			updateSimulationState,
		],
	);

	const registrations = [
		useSignettTool(signett, tools.inspect, [tools.inspect]),
		useSignettTool(signett, tools.contact, [tools.contact]),
		useSignettTool(signett, tools.deliveryOptions, [tools.deliveryOptions]),
		useSignettTool(signett, tools.delivery, [tools.delivery]),
		useSignettTool(signett, tools.submitRequest, [tools.submitRequest]),
	];
	const requestActivity = useSignettActivity(signett, {
		toolName: "submit_purchase_request",
		maxInvocations: 5,
	});

	const decideApproval = useCallback((confirmed: boolean) => {
		setApproval((current) => {
			current?.resolve(confirmed);
			return null;
		});
	}, []);

	const toggleSimulation = useCallback(() => {
		if (simulation.read() === "armed") {
			sessionStorage.removeItem(LOST_RESPONSE_FAULT);
			updateSimulationState("ready");
			return;
		}
		sessionStorage.setItem(LOST_RESPONSE_FAULT, "armed");
		setProof({ recovered: false, replayed: false });
		updateSimulationState("armed");
	}, [simulation, updateSimulationState]);

	if (process.env.NEXT_PUBLIC_SIGNETT_DEMO !== "true") return null;

	return (
		<SignetDemoPanel
			approval={approval}
			activity={requestActivity.latest}
			events={events}
			proof={proof}
			registeredCount={registrations.filter(({ status }) => status === "registered").length}
			simulationState={simulationState}
			traces={traces}
			verifiedRequest={verifiedRequest}
			onApproval={decideApproval}
			onToggleSimulation={toggleSimulation}
		/>
	);
}
