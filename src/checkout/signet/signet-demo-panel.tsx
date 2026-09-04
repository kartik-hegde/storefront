"use client";

import { useState } from "react";
import type { GuardEvent, SignettActivity } from "signett";
import type { InvocationTrace } from "signett/opentelemetry";
import {
	Check,
	CircleAlert,
	CircleX,
	Clock3,
	LoaderCircle,
	ShieldAlert,
	Terminal,
	X,
	Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { ResponseLossSimulationState } from "./checkout-model";
import type { CheckoutRequestProof } from "./checkout-operations";
import { SignettTelemetryView } from "./signet-telemetry-view";

export type ApprovalRequest = {
	title: string;
	detail: string;
	resolve(confirmed: boolean): void;
};

type SignetDemoPanelProps = {
	approval: ApprovalRequest | null;
	activity: SignettActivity | undefined;
	events: GuardEvent[];
	proof: { recovered: boolean; replayed: boolean };
	registeredCount: number;
	simulationState: ResponseLossSimulationState;
	traces: readonly InvocationTrace[];
	verifiedRequest: CheckoutRequestProof | null;
	onApproval(confirmed: boolean): void;
	onToggleSimulation(): void;
};

const AGENT_PROMPT = "Submit this checkout as a purchase request using the cheapest delivery option.";

function eventTone(stage: GuardEvent["stage"]): string {
	if (stage === "failed") return "text-destructive";
	if (stage === "outcome_unknown") return "text-warning";
	if (stage === "succeeded" || stage === "verified" || stage === "recovered") return "text-success";
	return "text-muted-foreground";
}

function ActivityState({
	activity,
	verifiedRequest,
}: Pick<SignetDemoPanelProps, "activity" | "verifiedRequest">) {
	const verified = activity?.phase === "succeeded" && activity.verified;
	const status = (() => {
		switch (activity?.phase) {
			case "running":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Agent is working",
					detail: "Signett is validating intent before the Saleor effect.",
					tone: "border-call text-foreground",
				};
			case "awaiting_confirmation":
				return {
					icon: <Clock3 className="size-4" aria-hidden />,
					label: "Waiting for your approval",
					detail: "No request is submitted until the visible confirmation is approved.",
					tone: "border-warning text-foreground",
				};
			case "verifying":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Verifying with Saleor",
					detail: "The mutation returned; the UI is waiting for authoritative proof.",
					tone: "border-call text-foreground",
				};
			case "succeeded":
				return verified
					? {
							icon: <Check className="size-4" aria-hidden />,
							label: "Purchase request verified in Saleor",
							detail: `${activity.resolution ?? "executed"} · ${activity.durationMs} ms · request ${verifiedRequest?.requestId ?? "confirmed"}`,
							tone: "border-success text-foreground",
						}
					: {
							icon: <ShieldAlert className="size-4" aria-hidden />,
							label: "Action finished without proof",
							detail: "The storefront will not present this as a submitted request.",
							tone: "border-warning text-foreground",
						};
			case "declined":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Request declined",
					detail: "Nothing was submitted and the checkout remains editable.",
					tone: "border-border text-muted-foreground",
				};
			case "failed":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Action failed safely",
					detail: "The agent receives structured repair guidance for the next step.",
					tone: "border-destructive text-foreground",
				};
			case "unknown":
				return {
					icon: <ShieldAlert className="size-4" aria-hidden />,
					label: "Outcome unknown — do not retry blindly",
					detail:
						"Signett retains the internal operation ID so it can recover without duplicating the effect.",
					tone: "border-warning text-foreground",
				};
			default:
				return {
					icon: <span className="mt-1 block size-2 rounded-full bg-call" aria-hidden />,
					label: "Ready for the Signett Chrome Agent",
					detail: "Add an item, open checkout, then give the agent the prompt below.",
					tone: "border-call text-foreground",
				};
		}
	})();

	return (
		<div className={cn("border-l-2 py-1 pl-3", status.tone)} aria-live="polite">
			<div className="flex items-start gap-2.5">
				<span className="mt-0.5">{status.icon}</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-medium">{status.label}</p>
					<p className="mt-1 text-xs leading-5 text-muted-foreground">{status.detail}</p>
				</div>
			</div>
		</div>
	);
}

const SIMULATION_STEPS: ReadonlyArray<{
	state: ResponseLossSimulationState;
	label: string;
	detail: string;
}> = [
	{ state: "ready", label: "Ready", detail: "Normal request" },
	{ state: "armed", label: "Armed", detail: "Next request" },
	{ state: "triggered", label: "Triggered", detail: "Reply dropped" },
	{ state: "recovered", label: "Recovered", detail: "Request verified" },
];

function ResponseLossSimulation({
	simulationState,
	onToggleSimulation,
}: Pick<SignetDemoPanelProps, "simulationState" | "onToggleSimulation">) {
	const activeIndex = SIMULATION_STEPS.findIndex(({ state }) => state === simulationState);
	const control = (() => {
		switch (simulationState) {
			case "armed":
				return { label: "Simulation armed", action: "Cancel", disabled: false };
			case "triggered":
				return { label: "Recovering the committed request", action: "Working", disabled: true };
			case "recovered":
				return { label: "Response loss recovered", action: "Run again", disabled: false };
			default:
				return { label: "Simulate lost request response", action: "Arm", disabled: false };
		}
	})();

	return (
		<section className="space-y-3 border-b border-border pb-5" aria-labelledby="response-loss-title">
			<div>
				<h3 id="response-loss-title" className="text-xs font-medium text-foreground">
					Post-commit recovery simulation
				</h3>
				<p className="mt-1 text-[11px] leading-4 text-muted-foreground">
					The next purchase request is saved in Saleor, but its browser response is intentionally dropped.
				</p>
			</div>

			<ol className="grid grid-cols-4 border-y border-border py-3" aria-label="Simulation progress">
				{SIMULATION_STEPS.map((step, index) => {
					const complete = index < activeIndex || simulationState === "recovered";
					const active = index === activeIndex;
					return (
						<li
							className="min-w-0 px-1 text-center"
							key={step.state}
							aria-current={active ? "step" : undefined}
						>
							<span
								className={cn(
									"mx-auto grid size-5 place-items-center rounded-full border font-mono text-[9px]",
									complete && "border-success bg-success text-primary-foreground",
									active && !complete && "border-signal text-signal",
									!active && !complete && "border-border text-muted-foreground",
								)}
							>
								{complete ? <Check className="size-3" aria-hidden /> : index + 1}
							</span>
							<p
								className={cn(
									"mt-1.5 truncate text-[10px] font-medium",
									active ? "text-foreground" : "text-muted-foreground",
								)}
							>
								{step.label}
							</p>
							<p className="mt-0.5 truncate text-[9px] text-muted-foreground">{step.detail}</p>
						</li>
					);
				})}
			</ol>

			<button
				className={cn(
					"flex min-h-11 w-full items-center justify-between rounded-button border px-3.5 py-3 text-left text-sm transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait",
					simulationState === "armed" || simulationState === "triggered" || simulationState === "recovered"
						? "border-signal text-signal"
						: "border-border bg-background text-foreground hover:border-foreground",
				)}
				disabled={control.disabled}
				onClick={onToggleSimulation}
				type="button"
			>
				<span className="flex items-center gap-2">
					{simulationState === "triggered" ? (
						<LoaderCircle className="size-4 animate-spin" aria-hidden />
					) : (
						<Zap className="size-4" aria-hidden />
					)}
					{control.label}
				</span>
				<span className="text-xs text-muted-foreground">{control.action}</span>
			</button>
		</section>
	);
}

export function SignetDemoPanel({
	approval,
	activity,
	events,
	proof,
	registeredCount,
	simulationState,
	traces,
	verifiedRequest,
	onApproval,
	onToggleSimulation,
}: SignetDemoPanelProps) {
	const [view, setView] = useState<"demo" | "telemetry" | "developer">("demo");
	const [copied, setCopied] = useState(false);

	const copyPrompt = () => {
		void navigator.clipboard.writeText(AGENT_PROMPT).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		});
	};

	return (
		<>
			<aside
				className="fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-card shadow-elevated"
				data-testid="signet-demo-panel"
			>
				<div className="sticky top-0 z-10 border-b border-border bg-card px-5 pt-4 text-foreground">
					<div className="flex items-center justify-between gap-3">
						<div>
							<p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
								<span className="size-2 bg-signal" aria-hidden /> Signett / Saleor
							</p>
							<h2 className="mt-1 text-sm font-semibold">Agent checkout proof</h2>
						</div>
						<span className="font-mono text-[10px] text-muted-foreground">
							{registeredCount}/5 tools live
						</span>
					</div>

					<nav className="mt-4 grid grid-cols-3 text-xs" aria-label="Demo views">
						<button
							aria-pressed={view === "demo"}
							className={cn(
								"border-b-2 border-transparent px-2 pb-2.5 text-muted-foreground",
								view === "demo" && "border-signal text-foreground",
							)}
							onClick={() => setView("demo")}
							type="button"
						>
							Live demo
						</button>
						<button
							aria-pressed={view === "telemetry"}
							className={cn(
								"border-b-2 border-transparent px-2 pb-2.5 text-muted-foreground",
								view === "telemetry" && "border-signal text-foreground",
							)}
							onClick={() => setView("telemetry")}
							type="button"
						>
							Telemetry
						</button>
						<button
							aria-pressed={view === "developer"}
							className={cn(
								"border-b-2 border-transparent px-2 pb-2.5 text-muted-foreground",
								view === "developer" && "border-signal text-foreground",
							)}
							onClick={() => setView("developer")}
							type="button"
						>
							Developer proof
						</button>
					</nav>
				</div>

				<div className="space-y-5 p-5">
					<ActivityState activity={activity} verifiedRequest={verifiedRequest} />

					{view === "demo" ? (
						<>
							<div className="grid grid-cols-3 divide-x divide-border border-y border-border text-xs">
								{[
									["01", "intent", "validated"],
									["02", "effect", "idempotent"],
									["03", "outcome", "verified"],
								].map(([number, label, value]) => (
									<div className="px-3 py-3" key={label}>
										<p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
											{number} {label}
										</p>
										<p className="mt-1 font-medium text-foreground">{value}</p>
									</div>
								))}
							</div>

							<div className="border-b border-border pb-5">
								<div className="mb-2 flex items-center justify-between gap-3">
									<p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
										Chrome Agent prompt
									</p>
									<button
										className="text-xs font-medium text-foreground hover:text-signal"
										onClick={copyPrompt}
										type="button"
									>
										{copied ? "Copied" : "Copy"}
									</button>
								</div>
								<p className="text-xs leading-5 text-muted-foreground">{AGENT_PROMPT}</p>
							</div>

							<ResponseLossSimulation
								simulationState={simulationState}
								onToggleSimulation={onToggleSimulation}
							/>

							{proof.recovered || proof.replayed ? (
								<div className="space-y-2 border-l-2 border-success py-1 pl-3 text-xs">
									{proof.recovered ? (
										<p className="flex items-center gap-2 font-medium text-success">
											<Check className="size-3.5" aria-hidden /> Lost response recovered from Saleor
										</p>
									) : null}
									{proof.replayed ? (
										<p className="flex items-center gap-2 font-medium text-success">
											<Check className="size-3.5" aria-hidden /> Exact retry replayed; no duplicate request
										</p>
									) : null}
								</div>
							) : null}
						</>
					) : view === "telemetry" ? (
						<SignettTelemetryView traces={traces} />
					) : (
						<>
							<div className="border-b border-border pb-5">
								<p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
									<Terminal className="size-3.5" aria-hidden /> Reproduce from the terminal
								</p>
								<pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
									<code>{`npx signett agent \\
  --url "$CHECKOUT_URL" \\
  --prompt "${AGENT_PROMPT}" \\
  --endpoint "$OPENAI_COMPATIBLE_ENDPOINT" \\
  --model "$MODEL" \\
  --api-key-env OPENAI_API_KEY \\
  --output signett-saleor-evidence.json`}</code>
								</pre>
							</div>

							<div className="grid grid-cols-2 divide-x divide-border border-y border-border text-xs">
								<div className="py-3 pr-3">
									<p className="font-medium text-foreground">Same tool contract</p>
									<p className="mt-1 leading-5 text-muted-foreground">
										Browser, tests, and evals share schemas.
									</p>
								</div>
								<div className="py-3 pl-3">
									<p className="font-medium text-foreground">Metadata-only traces</p>
									<p className="mt-1 leading-5 text-muted-foreground">No checkout inputs are logged here.</p>
								</div>
							</div>

							<div>
								<div className="mb-2 flex items-center justify-between">
									<p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
										Lifecycle trace
									</p>
									<span className="text-xs text-muted-foreground">latest first</span>
								</div>
								<div className="max-h-44 space-y-1.5 overflow-y-auto border-t border-border pt-2.5">
									{events.length === 0 ? (
										<p className="py-3 text-center text-xs text-muted-foreground">
											Waiting for an agent tool call…
										</p>
									) : (
										events.map((event) => (
											<div
												className="flex items-center justify-between gap-3 text-xs"
												key={`${event.invocationId}:${event.stage}:${event.timestamp}`}
											>
												<span className="truncate text-muted-foreground">{event.name ?? "registration"}</span>
												<span className={cn("font-medium", eventTone(event.stage))}>{event.stage}</span>
											</div>
										))
									)}
								</div>
							</div>
						</>
					)}
				</div>
			</aside>

			{approval ? (
				<div
					className="fixed inset-0 z-[60] grid place-items-center bg-foreground/55 p-4"
					data-testid="signet-approval"
				>
					<div className="w-full max-w-md rounded-card border border-border bg-card p-6 shadow-overlay">
						<div className="mb-5 flex items-start gap-3">
							<span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground">
								<CircleAlert className="size-5" aria-hidden />
							</span>
							<div>
								<p className="text-eyebrow text-muted-foreground">Agent requests approval</p>
								<h2 className="mt-1 text-h3 text-foreground">{approval.title}</h2>
								<p className="mt-2 text-sm leading-6 text-muted-foreground">{approval.detail}</p>
							</div>
						</div>
						<div className="flex justify-end gap-3">
							<button
								className="inline-flex items-center gap-2 rounded-button border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
								onClick={() => onApproval(false)}
								type="button"
							>
								<X className="size-4" aria-hidden /> Decline
							</button>
							<button
								className="inline-flex items-center gap-2 rounded-button bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
								onClick={() => onApproval(true)}
								type="button"
							>
								<Check className="size-4" aria-hidden /> Submit request
							</button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
