"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  XOctagon,
  Gamepad2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { useWorkspaceId } from "@multica/core/hooks";
import { useCurrentWorkspace } from "@multica/core/paths";
import { agentListOptions } from "@multica/core/workspace/queries";
import { projectListOptions } from "@multica/core/projects/queries";
import { issueListOptions } from "@multica/core/issues/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";

import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@multica/ui/components/ui/card";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@multica/ui/components/ui/chart";
import { cn } from "@multica/ui/lib/utils";

import { PageHeader } from "../../layout/page-header";
import {
  computeIssueKpis,
  statusBreakdown,
  topProjects,
  dailyTrend,
  agentStatuses,
  assignmentSplit,
  type IssueStatus,
} from "../utils";

// 2D top-down — pixel-art Pokemon Gen3 style Canvas. SSR-disabled because
// Canvas needs the browser document. This is now the only Cohort Station
// view — the 3D R3F scene was removed for performance and consistency.
const CohortStation2D = dynamic(
  () =>
    import("./cohort-station-2d").then((m) => ({ default: m.CohortStation2D })),
  {
    ssr: false,
    loading: () => <Skeleton className="aspect-[16/9] w-full rounded-lg" />,
  },
);

// ============================================================
// Constants - couleurs status (cohérent avec Cohort coral palette)
// ============================================================
const STATUS_COLOR: Record<IssueStatus, string> = {
  backlog: "#94A3B8",
  todo: "#1E3E98",
  in_progress: "#FF6F61",
  in_review: "#7C3AED",
  blocked: "#EC4899",
  done: "#10B981",
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  blocked: "Blocked",
  done: "Done",
};

// Trend chart — same visual language as the Usage page (BarChart with
// shadcn ChartContainer + ChartTooltipContent). Bars are stacked: created
// (chart-1) at the bottom, done (chart-2) on top, rounded radius on the
// topmost segment only. The label key is pre-formatted client-side so the
// X axis shows e.g. "May 14" instead of an ISO string.
const trendChartConfig = {
  created: { label: "Created", color: "var(--chart-1)" },
  done: { label: "Done", color: "var(--chart-2)" },
} satisfies ChartConfig;

// ============================================================
// Main page
// ============================================================
export function CohortDashboardPage() {
  const wsId = useWorkspaceId();
  const workspace = useCurrentWorkspace();
  const router = useRouter();

  const { data: issues = [], isLoading: issuesLoading } = useQuery(
    issueListOptions(wsId),
  );
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));

  // === Calculs (memoizes pour ne pas recalculer a chaque render) ===
  const kpis = useMemo(() => computeIssueKpis(issues), [issues]);
  const statuses = useMemo(() => statusBreakdown(issues), [issues]);
  const trend = useMemo(() => {
    return dailyTrend(issues, 30).map((d) => ({
      ...d,
      label: new Date(d.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    }));
  }, [issues]);
  const trendTotals = useMemo(() => {
    const created = trend.reduce((s, d) => s + d.created, 0);
    const done = trend.reduce((s, d) => s + d.done, 0);
    return { created, done };
  }, [trend]);
  const tops = useMemo(() => topProjects(projects, 6), [projects]);
  const assign = useMemo(() => assignmentSplit(issues), [issues]);
  const statuses_3d = useMemo(
    () => agentStatuses(agents, issues, runtimes),
    [agents, issues, runtimes],
  );

  const blockedAlertVisible = kpis.blocked > 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader>
        <LayoutDashboard className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <h1 className="truncate text-sm font-medium">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-success" />
          <span>Live · {runtimes.filter((r) => r.status === "online").length} runtimes online</span>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          {/* Sous-titre */}
          <p className="text-xs text-muted-foreground">
            Vue d'ensemble {workspace?.name ?? "Cohort"} — {kpis.total} issues actives, {agents.length} agents
          </p>

          {/* Alerte blocked */}
          {blockedAlertVisible && (
            <div className="flex items-center gap-3 rounded-xl bg-accent/50 px-4 py-3 ring-1 ring-brand/25">
              <AlertCircle className="h-5 w-5 shrink-0 text-brand" />
              <div className="flex-1 text-sm">
                <strong className="font-semibold text-brand">
                  {kpis.blocked} issue{kpis.blocked > 1 ? "s" : ""} bloquée{kpis.blocked > 1 ? "s" : ""}
                </strong>
                {" "}demandent ton attention.
              </div>
              <button
                type="button"
                onClick={() => router.push(`/${workspace?.slug}/issues?status=blocked`)}
                className="rounded-md bg-card px-3 py-1 text-xs font-medium text-brand ring-1 ring-brand hover:bg-brand hover:text-white"
              >
                Voir →
              </button>
            </div>
          )}

          {/* KPI Row */}
          {issuesLoading ? (
            <Skeleton className="h-28 rounded-xl" />
          ) : (
            <div className="grid grid-cols-1 divide-y rounded-xl bg-card ring-1 ring-foreground/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
              <KpiTile
                icon={<LayoutDashboard className="h-4 w-4 text-muted-foreground" />}
                label="Issues totales"
                value={kpis.total}
                hint="+12 cette semaine"
              />
              <KpiTile
                icon={<Clock className="h-4 w-4 text-brand" />}
                label="En cours"
                value={kpis.inProgress}
                hint="agents actifs"
              />
              <KpiTile
                icon={<CheckCircle2 className="h-4 w-4 text-success" />}
                label="Terminées"
                value={kpis.done}
                hint={`${kpis.completionPct}% completion`}
                accent="success"
              />
              <KpiTile
                icon={<XOctagon className="h-4 w-4 text-destructive" />}
                label="Bloquées"
                value={kpis.blocked}
                hint={kpis.blocked > 0 ? "action requise" : "tout fluide"}
                accent={kpis.blocked > 0 ? "destructive" : "default"}
              />
            </div>
          )}

          {/* Trend chart — same shadcn ChartContainer pattern as the Usage page */}
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">Issue activity — last 30 days</h4>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-chart-1" />
                  Created <span className="font-medium text-foreground tabular-nums">{trendTotals.created}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-chart-2" />
                  Done <span className="font-medium text-foreground tabular-nums">{trendTotals.done}</span>
                </span>
              </div>
            </div>
            <div className="min-h-[240px]">
              {issuesLoading ? (
                <Skeleton className="aspect-[3/1] w-full" />
              ) : (
                <ChartContainer config={trendChartConfig} className="aspect-[3/1] w-full">
                  <BarChart data={trend} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      allowDecimals={false}
                      width={40}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value, name) => `${value} ${name}`}
                          footer={(payload) => {
                            const total = payload.reduce(
                              (sum, item) =>
                                sum +
                                (typeof item.value === "number" ? item.value : 0),
                              0,
                            );
                            return (
                              <div className="flex items-center justify-between gap-2 font-medium">
                                <span>Total</span>
                                <span className="font-mono tabular-nums">
                                  {total.toLocaleString()}
                                </span>
                              </div>
                            );
                          }}
                        />
                      }
                    />
                    <Bar
                      dataKey="created"
                      stackId="issues"
                      fill="var(--color-created)"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="done"
                      stackId="issues"
                      fill="var(--color-done)"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </div>
          </div>

          {/* Cohort Station — 2D pixel-art top-down view of the workspace */}
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <Gamepad2 className="h-4 w-4 text-brand" />
                  Cohort Station — {agents.length} agents
                </span>
                <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
                  {statuses_3d.filter((a) => a.status === "active").length} active ·{" "}
                  {statuses_3d.filter((a) => a.status === "idle").length} idle ·{" "}
                  {statuses_3d.filter((a) => a.status === "offline").length} offline
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CohortStation2D
                agentStatuses={statuses_3d}
                onAgentClick={(id) => router.push(`/${workspace?.slug}/agents/${id}`)}
              />
            </CardContent>
          </Card>

          {/* Grid main : status breakdown + top projets */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Status breakdown */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle>Issues par status</CardTitle>
              </CardHeader>
              <CardContent className="px-0 py-0">
                {issuesLoading ? (
                  <Skeleton className="m-4 h-48" />
                ) : (
                  <div className="divide-y">
                    {statuses.map((s) => (
                      <div
                        key={s.status}
                        className="grid grid-cols-[120px_1fr_40px_50px] items-center gap-3 px-4 py-2 text-sm"
                      >
                        <div className="flex items-center gap-2 font-medium">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: STATUS_COLOR[s.status] }}
                          />
                          {STATUS_LABEL[s.status]}
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${s.pct}%`, background: STATUS_COLOR[s.status] }}
                          />
                        </div>
                        <div className="text-right font-medium tabular-nums">{s.count}</div>
                        <div className="text-right text-xs text-muted-foreground tabular-nums">
                          {s.pct.toFixed(1)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top projets */}
            <Card>
              <CardHeader className="border-b pb-3">
                <CardTitle>Top projets actifs</CardTitle>
              </CardHeader>
              <CardContent className="px-0 py-0">
                <div className="divide-y">
                  {tops.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => router.push(`/${workspace?.slug}/projects/${p.id}`)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/40"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-chart-1/10 text-sm">
                        {p.icon ?? "📁"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {p.issueCount} issues · {p.doneCount} done
                        </div>
                      </div>
                      <div className="w-20">
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-chart-1"
                            style={{ width: `${p.progressPct}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                        {p.progressPct}%
                      </span>
                      <Badge
                        variant={p.status === "in_progress" ? "default" : "secondary"}
                        className={cn(
                          "ml-1 text-[10px] uppercase",
                          p.status === "in_progress" && "bg-accent text-brand",
                        )}
                      >
                        {p.status === "in_progress" ? "Actif" : "Planifié"}
                      </Badge>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Assignment split */}
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-brand" />
                Qui fait le travail ?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <SplitTile label="Agents IA" value={assign.agent} color="#7C3AED" />
                <SplitTile label="Humains" value={assign.member} color="#FF6F61" />
                <SplitTile label="Non assignées" value={assign.unassigned} color="#94A3B8" />
              </div>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                <strong className="text-chart-3">{assign.agentPct}%</strong> des tâches portées par des agents IA
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SUBCOMPONENTS
// ============================================================
function KpiTile({
  icon,
  label,
  value,
  hint,
  accent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  accent?: "default" | "brand" | "success" | "destructive";
}) {
  const valueClass =
    accent === "brand"
      ? "text-brand"
      : accent === "success"
        ? "text-success"
        : accent === "destructive"
          ? "text-destructive"
          : "";
  return (
    <div className="flex flex-col gap-2 p-5">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("text-3xl font-semibold leading-none tabular-nums", valueClass)}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function SplitTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg border p-4 text-center"
      style={{ borderColor: `${color}40`, background: `${color}10` }}
    >
      <div className="text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

