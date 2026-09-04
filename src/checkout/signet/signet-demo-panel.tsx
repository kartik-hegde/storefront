"use client";

import { useState } from "react";
import type { GuardEvent, SignettActivity } from "signett";
import type { InvocationTrace } from "signett/opentelemetry";
import {
	Check,
	CircleAlert,
	CircleX,
	Clock3,
	Database,
	LoaderCircle,
	SearchCheck,
	ShieldAlert,
	Terminal,
	WifiOff,
	X,
	Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { ResponseLossSimulationState } from "./checkout-model";
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

function formatDuration(durationMs: number): string {
	return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function ActivityState({ activity }: Pick<SignetDemoPanelProps, "activity">) {
	const verified = activity?.phase === "succeeded" && activity.verified;
	const status = (() => {
		switch (activity?.phase) {
			case "running":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Running checkout tools…",
					tone: "border-call text-foreground",
				};
			case "awaiting_confirmation":
				return {
					icon: <Clock3 className="size-4" aria-hidden />,
					label: "Approval required",
					tone: "border-warning text-foreground",
				};
			case "verifying":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Verifying in Saleor…",
					tone: "border-call text-foreground",
				};
			case "succeeded":
				return verified
					? {
							icon: <Check className="size-4" aria-hidden />,
							label:
								activity.resolution === "recovered"
									? "Recovered safely — no duplicate submission"
									: "Verified in Saleor",
							detail: `${activity.resolution === "recovered" ? "verified in Saleor" : (activity.resolution ?? "executed")} · ${formatDuration(activity.durationMs)}`,
							tone: "border-success text-foreground",
						}
					: {
							icon: <ShieldAlert className="size-4" aria-hidden />,
							label: "Action finished without proof",
							tone: "border-warning text-foreground",
						};
			case "declined":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Request declined",
					tone: "border-border text-muted-foreground",
				};
			case "failed":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Action failed safely",
					tone: "border-destructive text-foreground",
				};
			case "unknown":
				return {
					icon: <ShieldAlert className="size-4" aria-hidden />,
					label: "Outcome unknown — do not retry blindly",
					tone: "border-warning text-foreground",
				};
			default:
				return {
					icon: <span className="mt-1 block size-2 rounded-full bg-call" aria-hidden />,
					label: "Ready for Signett",
					tone: "border-call text-foreground",
				};
		}
	})();

	return (
		<div className={cn("border-l-2 py-1.5 pl-3", status.tone)} aria-live="polite">
			<div className="flex items-center gap-2.5">
				<span>{status.icon}</span>
				<p className="min-w-0 flex-1 truncate text-sm font-medium">{status.label}</p>
				{"detail" in status && status.detail ? (
					<span className="shrink-0 text-xs text-muted-foreground">{status.detail}</span>
				) : null}
			</div>
		</div>
	);
}

function ResponseLossSimulation({
	simulationState,
	onToggleSimulation,
}: Pick<SignetDemoPanelProps, "simulationState" | "onToggleSimulation">) {
	const control = (() => {
		switch (simulationState) {
			case "armed":
				return { label: "Post-commit timeout armed", action: "Cancel", disabled: false };
			case "triggered":
				return { label: "Response interrupted — checking Saleor", action: "Working", disabled: true };
			case "recovered":
				return { label: "Recovery complete", action: "Run again", disabled: false };
			default:
				return { label: "Simulate post-commit timeout", action: "Arm", disabled: false };
		}
	})();
	const receipt = [
		{
			icon: Database,
			label: "Effect saved in Saleor",
			detail: "The purchase request marker was committed.",
			complete: simulationState === "triggered" || simulationState === "recovered",
		},
		{
			icon: WifiOff,
			label: "Original response interrupted",
			detail: "The tool received no success result from its execute path.",
			complete: simulationState === "triggered" || simulationState === "recovered",
		},
		{
			icon: SearchCheck,
			label: "Original operation found",
			detail: "Signett read the same operation back from Saleor.",
			complete: simulationState === "recovered",
		},
		{
			icon: Check,
			label: "Outcome verified; UI released",
			detail: "No second mutation or approval was needed.",
			complete: simulationState === "recovered",
		},
	];

	return (
		<section className="space-y-3" aria-labelledby="response-loss-title">
			<div className="flex items-center justify-between gap-3">
				<h3 id="response-loss-title" className="text-xs font-medium text-foreground">
					Post-commit recovery
				</h3>
				<span className="text-[10px] text-muted-foreground">one-shot fault</span>
			</div>

			{simulationState === "armed" ? (
				<div className="rounded-card border border-warning bg-muted px-3.5 py-3">
					<p className="text-xs font-medium text-foreground">
						The next submission will fail after Saleor saves it.
					</p>
					<p className="mt-1 text-[11px] leading-4 text-muted-foreground">
						Signett must prove the existing effect instead of submitting again.
					</p>
				</div>
			) : null}

			{simulationState === "triggered" || simulationState === "recovered" ? (
				<ol
					className="divide-y divide-border rounded-card border border-border"
					aria-label="Recovery receipt"
				>
					{receipt.map((step) => {
						const Icon = step.icon;
						return (
							<li className="flex items-start gap-3 px-3.5 py-2.5" key={step.label}>
								<span
									className={cn(
										"mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
										step.complete ? "border-success text-success" : "border-border text-muted-foreground",
									)}
								>
									<Icon className={cn("size-3", !step.complete && "animate-pulse")} aria-hidden />
								</span>
								<div className="min-w-0">
									<p className="text-xs font-medium text-foreground">{step.label}</p>
									<p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{step.detail}</p>
								</div>
							</li>
						);
					})}
				</ol>
			) : null}

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
				className={cn(
					"fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-elevated transition-[width] duration-base ease-standard",
					view === "telemetry" ? "w-[min(46rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]",
				)}
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

				<div className="space-y-4 p-5">
					<ActivityState activity={activity} />

					{view === "demo" ? (
						<>
							<div className="rounded-card border border-border p-3.5">
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
								<p className="text-xs leading-5 text-foreground">{AGENT_PROMPT}</p>
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
