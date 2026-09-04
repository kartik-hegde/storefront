"use client";

import { useState } from "react";
import { Check, Clipboard, RadioTower, RotateCcw, ShieldCheck } from "lucide-react";
import { toOtlpJson, type InvocationTrace } from "signett/opentelemetry";

import { cn } from "@/lib/utils";

type Props = { traces: readonly InvocationTrace[] };

function outcomeTone(outcome: InvocationTrace["outcome"]): string {
	if (["succeeded", "replayed", "recovered"].includes(outcome)) return "text-success";
	if (["failed", "unknown", "denied", "declined"].includes(outcome)) return "text-destructive";
	return "text-muted-foreground";
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1) return "<1ms";
	if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
	return `${(durationMs / 1000).toFixed(1)}s`;
}

const PHASE_LABELS: Record<string, { label: string; detail: string }> = {
	"signett.validate": { label: "Validate input", detail: "Schema and arguments" },
	"signett.authorize": { label: "Authorize", detail: "Current app state" },
	"signett.confirm": { label: "Confirm effect", detail: "Visible user approval" },
	"signett.execute": { label: "Execute", detail: "Application action" },
	"signett.recover": { label: "Recover result", detail: "Reconcile operation journal" },
	"signett.replay": { label: "Replay result", detail: "Return the stored outcome" },
	"signett.output": { label: "Check output", detail: "Bounded tool response" },
	"signett.verify": { label: "Verify outcome", detail: "Read back from Saleor" },
};

function TraceWaterfall({ trace }: { trace: InvocationTrace }) {
	const total = Math.max(trace.durationMs, 1);
	return (
		<div className="space-y-3" data-testid="signett-trace-waterfall">
			{trace.phases.map((phase) => {
				const copy = PHASE_LABELS[phase.name] ?? { label: phase.name, detail: "Signett lifecycle" };
				const offset = Math.max(0, ((phase.startedAt - trace.startedAt) / total) * 100);
				const width = Math.max(3, (phase.durationMs / total) * 100);
				const boundedOffset = Math.min(offset, 97);
				const boundedWidth = Math.max(3, Math.min(width, 100 - boundedOffset));
				return (
					<div
						className="grid grid-cols-[8rem_1fr_3.25rem] items-center gap-3 text-[11px]"
						key={phase.spanId}
					>
						<div className="min-w-0">
							<p className="truncate font-medium text-foreground">{copy.label}</p>
							<p className="truncate text-[9px] text-muted-foreground">{copy.detail}</p>
						</div>
						<div className="relative h-1.5 overflow-hidden bg-muted">
							<span
								className={cn(
									"absolute top-0 h-full",
									phase.status === "error"
										? "bg-destructive"
										: phase.name === "signett.recover" || phase.name === "signett.verify"
											? "bg-success"
											: "bg-call",
								)}
								style={{ left: `${boundedOffset}%`, width: `${boundedWidth}%` }}
							/>
						</div>
						<span className="text-right tabular-nums text-muted-foreground">
							{formatDuration(phase.durationMs)}
						</span>
					</div>
				);
			})}
		</div>
	);
}

export function SignettTelemetryView({ traces }: Props) {
	const [copied, setCopied] = useState(false);
	const latest = traces[0];
	const recovered = latest?.resultSource === "recovered";
	const verified = latest?.phases.some(({ name }) => name === "signett.verify") ?? false;
	const copyOtlp = () => {
		const payload = toOtlpJson(traces, {
			serviceName: "signett-saleor-demo",
			resource: { "deployment.environment": "demo", "service.namespace": "webmcp" },
		});
		void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		});
	};

	return (
		<>
			<div className="border-b border-border pb-4">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
							<RadioTower className="size-3.5" aria-hidden /> Actual OpenTelemetry trace
						</p>
						<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
							Built from Signett lifecycle events. Inputs, addresses, and payment data are never included.
						</p>
					</div>
					<button
						className="inline-flex shrink-0 items-center gap-1.5 border-b border-foreground pb-0.5 text-[11px] font-medium text-foreground hover:text-signal disabled:border-muted disabled:text-muted-foreground"
						disabled={traces.length === 0}
						onClick={copyOtlp}
						type="button"
					>
						{copied ? <Check className="size-3" aria-hidden /> : <Clipboard className="size-3" aria-hidden />}
						{copied ? "Copied" : "Copy OTLP JSON"}
					</button>
				</div>
			</div>

			{latest ? (
				<div className="space-y-4 border-b border-border pb-5">
					<div
						className={cn(
							"rounded-card border p-4",
							recovered ? "border-success bg-muted" : "border-border bg-muted",
						)}
					>
						<div className="flex items-start gap-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-full border border-success text-success">
								{recovered ? (
									<RotateCcw className="size-4" aria-hidden />
								) : (
									<ShieldCheck className="size-4" aria-hidden />
								)}
							</span>
							<div className="min-w-0 flex-1">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-sm font-semibold text-foreground">
										{recovered
											? "Recovered without resubmitting"
											: verified
												? "Outcome verified"
												: "Trace complete"}
									</p>
									<span
										className={cn("font-mono text-[10px] font-medium uppercase", outcomeTone(latest.outcome))}
									>
										result source: {latest.resultSource ?? latest.outcome}
									</span>
								</div>
								<p className="mt-1 text-[11px] leading-5 text-muted-foreground">
									{recovered
										? "The execute path returned no result. Signett reconciled the journal against Saleor, then verified the backend state before releasing the UI."
										: verified
											? "Signett completed the guarded action and verified its effect against Saleor before releasing the UI."
											: "Signett completed the guarded tool call and captured its lifecycle as OpenTelemetry spans."}
								</p>
							</div>
						</div>
					</div>

					<div className="mb-3 flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-semibold text-foreground">{latest.name ?? "tool invocation"}</p>
							<p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
								trace {latest.traceId.slice(0, 16)}…
							</p>
						</div>
						<span className="font-mono text-[10px] text-muted-foreground">
							{formatDuration(latest.durationMs)} total
						</span>
					</div>
					<TraceWaterfall trace={latest} />
				</div>
			) : (
				<div className="border-b border-border py-7 text-center">
					<p className="text-sm font-medium text-foreground">No completed invocation yet</p>
					<p className="mt-1 text-xs text-muted-foreground">Run the agent workflow, then return here.</p>
				</div>
			)}

			<div className="text-xs">
				<p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
					Why this is more than WebMCP
				</p>
				<div className="mt-3 space-y-2.5">
					{[
						["Intent", "schema validated + app authorized"],
						["Effect", "confirmed + idempotently claimed"],
						["Failure", "journaled + recovered or marked unknown"],
						["Outcome", "verified from Saleor before UI success"],
					].map(([label, value]) => (
						<div className="grid grid-cols-[3.5rem_1fr] gap-2" key={label}>
							<span className="font-medium text-foreground">{label}</span>
							<span className="text-muted-foreground">{value}</span>
						</div>
					))}
				</div>
			</div>
		</>
	);
}
