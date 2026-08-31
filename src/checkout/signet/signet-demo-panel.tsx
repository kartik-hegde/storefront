import type { GuardEvent } from "@signet/webmcp";
import { Bot, Check, CircleAlert, ShieldCheck, Sparkles, X, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

export type ApprovalRequest = {
	title: string;
	detail: string;
	resolve(confirmed: boolean): void;
};

type SignetDemoPanelProps = {
	approval: ApprovalRequest | null;
	events: GuardEvent[];
	faultArmed: boolean;
	proof: { recovered: boolean; replayed: boolean };
	registeredCount: number;
	onArmFault(): void;
	onApproval(confirmed: boolean): void;
};

function eventTone(stage: GuardEvent["stage"]): string {
	if (stage === "failed") return "text-destructive";
	if (stage === "outcome_unknown") return "text-warning";
	if (stage === "succeeded" || stage === "verified" || stage === "recovered") return "text-success";
	return "text-muted-foreground";
}

export function SignetDemoPanel({
	approval,
	events,
	faultArmed,
	proof,
	registeredCount,
	onArmFault,
	onApproval,
}: SignetDemoPanelProps) {
	return (
		<>
			<aside
				className="fixed bottom-4 right-4 z-50 w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-border bg-card shadow-overlay"
				data-testid="signet-demo-panel"
			>
				<div className="border-b border-border bg-foreground px-5 py-4 text-inverse">
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-3">
							<span className="grid size-9 place-items-center rounded-full bg-background text-foreground">
								<ShieldCheck className="size-5" aria-hidden />
							</span>
							<div>
								<p className="text-eyebrow text-inverse-muted">Live agent checkout</p>
								<h2 className="text-base font-semibold">Protected by Signet</h2>
							</div>
						</div>
						<span className="rounded-full border border-inverse px-2.5 py-1 text-xs text-inverse-subtle">
							{registeredCount}/5 tools
						</span>
					</div>
				</div>

				<div className="space-y-4 p-5">
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
									<Check className="size-3.5" aria-hidden /> Exact retry replayed without a new order
								</p>
							) : null}
						</div>
					) : null}

					<div>
						<div className="mb-2 flex items-center justify-between">
							<p className="flex items-center gap-2 text-sm font-medium text-foreground">
								<Bot className="size-4" aria-hidden /> Agent trace
							</p>
							<span className="text-xs text-muted-foreground">metadata only</span>
						</div>
						<div className="max-h-40 space-y-1.5 overflow-y-auto rounded-card border border-border bg-background p-2.5">
							{events.length === 0 ? (
								<p className="py-3 text-center text-xs text-muted-foreground">
									Waiting for an agent tool call…
								</p>
							) : (
								events.map((event) => (
									<div
										className="flex items-center justify-between gap-3 text-xs"
										key={`${event.invocationId}:${event.stage}`}
									>
										<span className="truncate text-muted-foreground">{event.name ?? "registration"}</span>
										<span className={cn("font-medium", eventTone(event.stage))}>{event.stage}</span>
									</div>
								))
							)}
						</div>
					</div>
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

			<div className="sr-only" aria-live="polite">
				<Sparkles className="size-4" aria-hidden /> {registeredCount} Signet tools registered
			</div>
		</>
	);
}
