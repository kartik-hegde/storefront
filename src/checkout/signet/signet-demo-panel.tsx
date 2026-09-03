"use client";

import { useState } from "react";
import type { GuardEvent, SignettActivity } from "signett";
import type { InvocationTrace } from "signett/opentelemetry";
import {
	Activity,
	Bot,
	Check,
	CircleAlert,
	CircleX,
	Clock3,
	Code2,
	ExternalLink,
	LoaderCircle,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Terminal,
	X,
	Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { CheckoutOrderProof } from "./checkout-operations";
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
	faultArmed: boolean;
	proof: { recovered: boolean; replayed: boolean };
	registeredCount: number;
	traces: readonly InvocationTrace[];
	verifiedOrder: CheckoutOrderProof | null;
	onArmFault(): void;
	onApproval(confirmed: boolean): void;
	onViewOrder(): void;
};

const AGENT_PROMPT =
	"Complete this Saleor checkout using the cheapest eligible delivery. Use one stable operationId for place_order and finish the test order exactly once.";

function eventTone(stage: GuardEvent["stage"]): string {
	if (stage === "failed") return "text-destructive";
	if (stage === "outcome_unknown") return "text-warning";
	if (stage === "succeeded" || stage === "verified" || stage === "recovered") return "text-success";
	return "text-muted-foreground";
}

function ActivityState({
	activity,
	verifiedOrder,
	onViewOrder,
}: Pick<SignetDemoPanelProps, "activity" | "verifiedOrder" | "onViewOrder">) {
	const verified = activity?.phase === "succeeded" && activity.verified;
	const status = (() => {
		switch (activity?.phase) {
			case "running":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Agent is working",
					detail: "Signett is validating intent before the Saleor effect.",
					tone: "border-border bg-muted/60 text-foreground",
				};
			case "awaiting_confirmation":
				return {
					icon: <Clock3 className="size-4" aria-hidden />,
					label: "Waiting for your approval",
					detail: "No payment runs until the visible confirmation is approved.",
					tone: "border-warning/30 bg-warning/5 text-warning",
				};
			case "verifying":
				return {
					icon: <LoaderCircle className="size-4 animate-spin" aria-hidden />,
					label: "Verifying with Saleor",
					detail: "The mutation returned; the UI is waiting for authoritative proof.",
					tone: "border-border bg-muted/60 text-foreground",
				};
			case "succeeded":
				return verified
					? {
							icon: <Check className="size-4" aria-hidden />,
							label: "Order verified in Saleor",
							detail: `${activity.resolution ?? "executed"} · ${activity.durationMs} ms · paid order ${verifiedOrder?.number ?? "confirmed"}`,
							tone: "border-success/30 bg-success/5 text-success",
						}
					: {
							icon: <ShieldAlert className="size-4" aria-hidden />,
							label: "Action finished without proof",
							detail: "The storefront will not present this as a completed order.",
							tone: "border-warning/30 bg-warning/5 text-warning",
						};
			case "declined":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Order declined",
					detail: "Nothing was charged and the checkout remains editable.",
					tone: "border-border bg-muted/60 text-muted-foreground",
				};
			case "failed":
				return {
					icon: <CircleX className="size-4" aria-hidden />,
					label: "Action failed safely",
					detail: "The agent receives structured repair guidance for the next step.",
					tone: "border-destructive/30 bg-destructive/5 text-destructive",
				};
			case "unknown":
				return {
					icon: <ShieldAlert className="size-4" aria-hidden />,
					label: "Outcome unknown — do not retry blindly",
					detail: "Reuse the same operationId so Signett can recover instead of duplicating the effect.",
					tone: "border-warning/30 bg-warning/5 text-warning",
				};
			default:
				return {
					icon: <Bot className="size-4" aria-hidden />,
					label: "Ready for the Signett Chrome Agent",
					detail: "Add an item, open checkout, then give the agent the prompt below.",
					tone: "border-border bg-muted/60 text-foreground",
				};
		}
	})();

	return (
		<div className={cn("rounded-card border p-3.5", status.tone)} aria-live="polite">
			<div className="flex items-start gap-2.5">
				<span className="mt-0.5">{status.icon}</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm font-semibold">{status.label}</p>
					<p className="mt-1 text-xs leading-5 opacity-80">{status.detail}</p>
				</div>
			</div>
			{verified && verifiedOrder ? (
				<button
					className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-button bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
					onClick={onViewOrder}
					type="button"
				>
					View verified order <ExternalLink className="size-3.5" aria-hidden />
				</button>
			) : null}
		</div>
	);
}

export function SignetDemoPanel({
	approval,
	activity,
	events,
	faultArmed,
	proof,
	registeredCount,
	traces,
	verifiedOrder,
	onArmFault,
	onApproval,
	onViewOrder,
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
				className="fixed bottom-4 right-4 z-50 max-h-[calc(100vh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-border bg-card shadow-overlay"
				data-testid="signet-demo-panel"
			>
				<div className="sticky top-0 z-10 border-b border-border bg-foreground px-5 pb-3 pt-4 text-inverse">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<span className="grid size-9 place-items-center rounded-full bg-background text-foreground">
								<ShieldCheck className="size-5" aria-hidden />
							</span>
							<div>
								<p className="text-eyebrow text-inverse-muted">Live Saleor checkout</p>
								<h2 className="text-base font-semibold">Protected by Signett</h2>
							</div>
						</div>
						<span className="rounded-full border border-inverse px-2.5 py-1 text-xs text-inverse-subtle">
							{registeredCount}/5 tools
						</span>
					</div>

					<div className="mt-3 grid grid-cols-3 rounded-button bg-background/10 p-1 text-xs">
						<button
							className={cn("rounded-button px-3 py-1.5", view === "demo" && "bg-background text-foreground")}
							onClick={() => setView("demo")}
							type="button"
						>
							Live demo
						</button>
						<button
							className={cn(
								"rounded-button px-3 py-1.5",
								view === "telemetry" && "bg-background text-foreground",
							)}
							onClick={() => setView("telemetry")}
							type="button"
						>
							Telemetry
						</button>
						<button
							className={cn(
								"rounded-button px-3 py-1.5",
								view === "developer" && "bg-background text-foreground",
							)}
							onClick={() => setView("developer")}
							type="button"
						>
							Developer proof
						</button>
					</div>
				</div>

				<div className="space-y-4 p-5">
					<ActivityState activity={activity} verifiedOrder={verifiedOrder} onViewOrder={onViewOrder} />

					{view === "demo" ? (
						<>
							<div className="grid grid-cols-3 gap-2 text-center text-xs">
								{[
									["Intent", "validated"],
									["Effect", "idempotent"],
									["Outcome", "verified"],
								].map(([label, value]) => (
									<div className="rounded-card bg-muted px-2 py-2.5" key={label}>
										<p className="font-medium text-foreground">{value}</p>
										<p className="mt-0.5 text-muted-foreground">{label}</p>
									</div>
								))}
							</div>

							<div className="rounded-card border border-border bg-background p-3.5">
								<div className="mb-2 flex items-center justify-between gap-3">
									<p className="flex items-center gap-2 text-xs font-semibold text-foreground">
										<Sparkles className="size-3.5" aria-hidden /> Chrome Agent prompt
									</p>
									<button className="text-xs font-medium text-primary" onClick={copyPrompt} type="button">
										{copied ? "Copied" : "Copy"}
									</button>
								</div>
								<p className="text-xs leading-5 text-muted-foreground">{AGENT_PROMPT}</p>
							</div>

							<button
								className={cn(
									"flex w-full items-center justify-between rounded-button border px-3.5 py-2.5 text-left text-sm transition-colors duration-fast",
									faultArmed
										? "border-destructive bg-destructive/5 text-destructive"
										: "border-border bg-background text-foreground hover:bg-muted",
								)}
								onClick={onArmFault}
								type="button"
							>
								<span className="flex items-center gap-2">
									<Zap className="size-4" aria-hidden />
									{faultArmed ? "Lost response armed" : "Arm lost-response proof"}
								</span>
								<span className="text-xs text-muted-foreground">one shot</span>
							</button>

							{proof.recovered || proof.replayed ? (
								<div className="space-y-2 rounded-card border border-success/30 bg-success/5 p-3 text-xs">
									{proof.recovered ? (
										<p className="flex items-center gap-2 font-medium text-success">
											<Check className="size-3.5" aria-hidden /> Lost response recovered from Saleor
										</p>
									) : null}
									{proof.replayed ? (
										<p className="flex items-center gap-2 font-medium text-success">
											<Check className="size-3.5" aria-hidden /> Exact retry replayed; no new order
										</p>
									) : null}
								</div>
							) : null}
						</>
					) : view === "telemetry" ? (
						<SignettTelemetryView traces={traces} />
					) : (
						<>
							<div className="rounded-card border border-border bg-background p-3.5">
								<p className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
									<Terminal className="size-3.5" aria-hidden /> Reproduce from the terminal
								</p>
								<pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-5 text-muted-foreground">
									<code>{`git clone https://github.com/signettai/signett\ncd signett && npm ci\nnpm run saleor:native-smoke\nnpm run saleor:oracle`}</code>
								</pre>
							</div>

							<div className="grid grid-cols-2 gap-2 text-xs">
								<div className="rounded-card bg-muted p-3">
									<Code2 className="mb-2 size-4 text-foreground" aria-hidden />
									<p className="font-medium text-foreground">Same tool contract</p>
									<p className="mt-1 leading-5 text-muted-foreground">
										Browser, tests, and evals share schemas.
									</p>
								</div>
								<div className="rounded-card bg-muted p-3">
									<Activity className="mb-2 size-4 text-foreground" aria-hidden />
									<p className="font-medium text-foreground">Metadata-only traces</p>
									<p className="mt-1 leading-5 text-muted-foreground">No checkout inputs are logged here.</p>
								</div>
							</div>

							<div>
								<div className="mb-2 flex items-center justify-between">
									<p className="flex items-center gap-2 text-sm font-medium text-foreground">
										<Bot className="size-4" aria-hidden /> Lifecycle trace
									</p>
									<span className="text-xs text-muted-foreground">latest first</span>
								</div>
								<div className="max-h-44 space-y-1.5 overflow-y-auto rounded-card border border-border bg-background p-2.5">
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
								<Check className="size-4" aria-hidden /> Approve test order
							</button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
