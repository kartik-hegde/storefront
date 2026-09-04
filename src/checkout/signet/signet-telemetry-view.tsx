"use client";

import { useState } from "react";
import { Check, Clipboard, RadioTower } from "lucide-react";
import { toOtlpJson, type InvocationTrace } from "signett/opentelemetry";

import { cn } from "@/lib/utils";

type Props = { traces: readonly InvocationTrace[] };

function outcomeTone(outcome: InvocationTrace["outcome"]): string {
	if (["succeeded", "replayed", "recovered"].includes(outcome)) return "text-success";
	if (["failed", "unknown", "denied", "declined"].includes(outcome)) return "text-destructive";
	return "text-muted-foreground";
}

function TraceWaterfall({ trace }: { trace: InvocationTrace }) {
	const total = Math.max(trace.durationMs, 1);
	return (
		<div className="space-y-2.5" data-testid="signett-trace-waterfall">
			{trace.phases.map((phase) => {
				const offset = Math.max(0, ((phase.startedAt - trace.startedAt) / total) * 100);
				const width = Math.max(3, (phase.durationMs / total) * 100);
				const boundedOffset = Math.min(offset, 97);
				const boundedWidth = Math.max(3, Math.min(width, 100 - boundedOffset));
				return (
					<div className="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-[11px]" key={phase.spanId}>
						<span className="truncate text-muted-foreground">{phase.name}</span>
						<div className="relative h-1.5 overflow-hidden bg-muted">
							<span
								className={cn(
									"absolute top-0 h-full",
									phase.status === "error" ? "bg-destructive" : "bg-call",
								)}
								style={{ left: `${boundedOffset}%`, width: `${boundedWidth}%` }}
							/>
						</div>
						<span className="text-right tabular-nums text-muted-foreground">{phase.durationMs}ms</span>
					</div>
				);
			})}
		</div>
	);
}

export function SignettTelemetryView({ traces }: Props) {
	const [copied, setCopied] = useState(false);
	const latest = traces[0];
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
			<div className="border-b border-border pb-5">
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
				<div className="border-b border-border pb-5">
					<div className="mb-3 flex items-center justify-between gap-3">
						<div>
							<p className="text-sm font-semibold text-foreground">{latest.name ?? "tool invocation"}</p>
							<p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
								trace {latest.traceId.slice(0, 16)}…
							</p>
						</div>
						<span className={cn("font-mono text-[10px] font-medium", outcomeTone(latest.outcome))}>
							{latest.resultSource ?? latest.outcome} · {latest.durationMs}ms
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
