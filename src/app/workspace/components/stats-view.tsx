"use client";

import { useEffect, useState, useMemo } from "react";
import styles from "../../page.module.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  loadWorkspaceStats,
  type WorkspaceStats,
  type PostView,
} from "../../workspace-actions";

interface StatsViewProps {
  posts: PostView[];
}

interface ProviderCardProps {
  title: string;
  badgeLabel: string;
  badgeClass: string;
  metrics: {
    total: number;
    pct: number;
    successRate: number;
    avgLatencyMs: number;
    tokens: number;
    success: number;
  };
  calendarPosts: number;
}

function ProviderCard({ title, badgeLabel, badgeClass, metrics, calendarPosts }: ProviderCardProps) {
  return (
    <Card className={styles.kpiCard}>
      <div className={styles.kpiHeader}>
        <span className={styles.kpiTitle}>{title}</span>
        <Badge variant="outline" className={badgeClass}>{badgeLabel}</Badge>
      </div>
      <div className={styles.kpiMainValue}>{metrics.total}</div>
      <div className={styles.kpiSub}>
        {metrics.pct}% de las llamadas ({calendarPosts} posts en el calendario)
      </div>
      <div style={{ marginTop: "12px", marginBottom: "8px" }}>
        <Progress value={metrics.successRate} />
      </div>
      <div className={styles.kpiDetails}>
        <div className={styles.kpiDetailItem}>
          <b>{metrics.successRate}%</b>
          <span>Tasa de éxito</span>
        </div>
        <div className={styles.kpiDetailItem}>
          <b>{metrics.avgLatencyMs ? `${metrics.avgLatencyMs} ms` : "—"}</b>
          <span>Latencia media</span>
        </div>
        <div className={styles.kpiDetailItem}>
          <b>{metrics.tokens.toLocaleString()}</b>
          <span>Tokens consumidos</span>
        </div>
        <div className={styles.kpiDetailItem}>
          <b>{metrics.success} / {metrics.total}</b>
          <span>Éxitos</span>
        </div>
      </div>
    </Card>
  );
}

export function StatsView({ posts }: StatsViewProps) {
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<"all" | "30" | "7">("all");

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await loadWorkspaceStats();
      if (res.success) {
        setStats(res.data);
      } else {
        setError(res.error);
      }
    } catch {
      setError("No se pudieron cargar las estadísticas.");
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadWorkspaceStats()
      .then((res) => {
        if (!active) return;
        if (res.success) {
          setStats(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch(() => {
        if (!active) return;
        setError("No se pudieron cargar las estadísticas.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Compute posts summary from posts prop (or server response)
  const postsFromWorkspace = useMemo(() => {
    let groq = 0;
    let openai = 0;
    let fallback = 0;
    for (const post of posts) {
      if (post.generationOrigin === "groq") groq++;
      else if (post.generationOrigin === "openai") openai++;
      else if (post.generationOrigin === "fallback") fallback++;
    }
    const total = posts.length;
    return {
      total,
      groq,
      openai,
      fallback,
      groqPct: total > 0 ? Math.round((groq / total) * 100) : 0,
      openaiPct: total > 0 ? Math.round((openai / total) * 100) : 0,
      fallbackPct: total > 0 ? Math.round((fallback / total) * 100) : 0,
    };
  }, [posts]);

  // Filter logs based on chosen period
  const filteredLogs = useMemo(() => {
    if (!stats?.recentLogs) return [];
    if (filterPeriod === "all") return stats.recentLogs;

    const days = filterPeriod === "30" ? 30 : 7;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    return stats.recentLogs.filter((log) => new Date(log.createdAt) >= cutoff);
  }, [stats, filterPeriod]);

  // Compute metrics from filtered logs
  const callMetrics = useMemo(() => {
    let groqCalls = 0;
    let groqSuccess = 0;
    let groqLatencySum = 0;
    let groqLatencyCount = 0;
    let groqTokens = 0;

    let openAiCalls = 0;
    let openAiSuccess = 0;
    let openAiLatencySum = 0;
    let openAiLatencyCount = 0;
    let openAiTokens = 0;

    let fallbackCalls = 0;

    for (const log of filteredLogs) {
      if (log.provider === "groq") {
        groqCalls++;
        if (log.status === "success") groqSuccess++;
        if (typeof log.latencyMs === "number" && log.latencyMs > 0) {
          groqLatencySum += log.latencyMs;
          groqLatencyCount++;
        }
        if (typeof log.totalTokens === "number") groqTokens += log.totalTokens;
      } else if (log.provider === "openai") {
        openAiCalls++;
        if (log.status === "success") openAiSuccess++;
        if (typeof log.latencyMs === "number" && log.latencyMs > 0) {
          openAiLatencySum += log.latencyMs;
          openAiLatencyCount++;
        }
        if (typeof log.totalTokens === "number") openAiTokens += log.totalTokens;
      } else {
        fallbackCalls++;
      }
    }

    const totalCalls = groqCalls + openAiCalls + fallbackCalls;

    return {
      totalCalls,
      groq: {
        total: groqCalls,
        success: groqSuccess,
        pct: totalCalls > 0 ? Math.round((groqCalls / totalCalls) * 100) : 0,
        successRate: groqCalls > 0 ? Math.round((groqSuccess / groqCalls) * 100) : 100,
        avgLatencyMs: groqLatencyCount > 0 ? Math.round(groqLatencySum / groqLatencyCount) : 0,
        tokens: groqTokens,
      },
      openai: {
        total: openAiCalls,
        success: openAiSuccess,
        pct: totalCalls > 0 ? Math.round((openAiCalls / totalCalls) * 100) : 0,
        successRate: openAiCalls > 0 ? Math.round((openAiSuccess / openAiCalls) * 100) : 100,
        avgLatencyMs: openAiLatencyCount > 0 ? Math.round(openAiLatencySum / openAiLatencyCount) : 0,
        tokens: openAiTokens,
      },
      fallback: {
        total: fallbackCalls,
        pct: totalCalls > 0 ? Math.round((fallbackCalls / totalCalls) * 100) : 0,
      },
    };
  }, [filteredLogs]);

  return (
    <div className={styles.statsLayout}>
      <div className={styles.statsHeader}>
        <div>
          <h2>Estadísticas de IA (Groq vs OpenAI)</h2>
          <p>Supervisa el volumen de respuestas, fiabilidad, latencia y consumo de cada proveedor.</p>
        </div>
        <div className={styles.statsControls}>
          <Button
            variant={filterPeriod === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPeriod("all")}
          >
            Todo
          </Button>
          <Button
            variant={filterPeriod === "30" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPeriod("30")}
          >
            Últimos 30 días
          </Button>
          <Button
            variant={filterPeriod === "7" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterPeriod("7")}
          >
            Últimos 7 días
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchStats()}
            disabled={loading}
          >
            {loading ? "Cargando…" : "⟳ Actualizar"}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            color: "var(--destructive, #ef4444)",
            backgroundColor: "var(--destructive-subtle, #fef2f2)",
            border: "1px solid var(--destructive, #ef4444)",
            borderRadius: 8,
            padding: "10px 14px",
            margin: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className={styles.statsGrid}>
        {loading && !stats ? (
          [1, 2].map((key) => (
            <Card key={key} className={styles.kpiCard}>
              <Skeleton style={{ height: "24px", width: "60%", marginBottom: "12px" }} />
              <Skeleton style={{ height: "48px", width: "40%", marginBottom: "12px" }} />
              <Skeleton style={{ height: "16px", width: "80%" }} />
            </Card>
          ))
        ) : (
          <>
            <ProviderCard
              title="Proveedor Principal"
              badgeLabel="Groq"
              badgeClass={styles.badgeGroq}
              metrics={callMetrics.groq}
              calendarPosts={postsFromWorkspace.groq}
            />
            <ProviderCard
              title="Proveedor Secundario"
              badgeLabel="OpenAI"
              badgeClass={styles.badgeOpenai}
              metrics={callMetrics.openai}
              calendarPosts={postsFromWorkspace.openai}
            />

            {/* Fallback / Plantillas Card */}
            <Card className={styles.kpiCard}>
              <div className={styles.kpiHeader}>
                <span className={styles.kpiTitle}>Respaldo y Seguridad</span>
                <Badge variant="secondary" className={styles.badgeFallback}>Plantilla</Badge>
              </div>
              <div className={styles.kpiMainValue}>{postsFromWorkspace.fallback}</div>
              <div className={styles.kpiSub}>
                {postsFromWorkspace.fallbackPct}% posts generados con respaldo determinista
              </div>
              <div style={{ marginTop: "12px", marginBottom: "8px" }}>
                <Progress value={100 - postsFromWorkspace.fallbackPct} />
              </div>
              <div className={styles.kpiDetails}>
                <div className={styles.kpiDetailItem}>
                  <b>{callMetrics.fallback.total}</b>
                  <span>Fallbacks en llamadas</span>
                </div>
                <div className={styles.kpiDetailItem}>
                  <b>{postsFromWorkspace.total}</b>
                  <span>Total posts creados</span>
                </div>
                <div className={styles.kpiDetailItem}>
                  <b>{100 - postsFromWorkspace.fallbackPct}%</b>
                  <span>Generación IA efectiva</span>
                </div>
                <div className={styles.kpiDetailItem}>
                  <b>0 ms</b>
                  <span>Latencia plantilla</span>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Distribution Ratio Bar */}
      <div className={styles.ratioBarContainer}>
        <div className={styles.ratioBarTitle}>Distribución de posts generados en el Workspace</div>
        <div className={styles.ratioBar} role="progressbar" aria-label="Distribución por proveedor">
          <div
            className={styles.ratioSegmentGroq}
            style={{ width: `${postsFromWorkspace.groqPct}%` }}
            title={`Groq: ${postsFromWorkspace.groqPct}% (${postsFromWorkspace.groq})`}
          />
          <div
            className={styles.ratioSegmentOpenai}
            style={{ width: `${postsFromWorkspace.openaiPct}%` }}
            title={`OpenAI: ${postsFromWorkspace.openaiPct}% (${postsFromWorkspace.openai})`}
          />
          <div
            className={styles.ratioSegmentFallback}
            style={{ width: `${postsFromWorkspace.fallbackPct}%` }}
            title={`Plantilla: ${postsFromWorkspace.fallbackPct}% (${postsFromWorkspace.fallback})`}
          />
        </div>
        <div className={styles.ratioLegend}>
          <div className={styles.ratioLegendItem}>
            <span className={styles.ratioDot} style={{ background: "#f97316" }} />
            <span>Groq: <b>{postsFromWorkspace.groq}</b> ({postsFromWorkspace.groqPct}%)</span>
          </div>
          <div className={styles.ratioLegendItem}>
            <span className={styles.ratioDot} style={{ background: "#10b981" }} />
            <span>OpenAI: <b>{postsFromWorkspace.openai}</b> ({postsFromWorkspace.openaiPct}%)</span>
          </div>
          <div className={styles.ratioLegendItem}>
            <span className={styles.ratioDot} style={{ background: "#94a3b8" }} />
            <span>Plantilla (Fallback): <b>{postsFromWorkspace.fallback}</b> ({postsFromWorkspace.fallbackPct}%)</span>
          </div>
        </div>
      </div>

      {/* Call Logs Table */}
      <div className={styles.tableCard}>
        <div className={styles.tableHeader}>
          <h3>Histórico de llamadas y peticiones recientes ({filteredLogs.length})</h3>
        </div>
        <div className={styles.tableWrapper}>
          {filteredLogs.length === 0 ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#8c8b96", fontSize: "14px" }}>
              No hay llamadas registradas en este período. Las nuevas generaciones de eventos se registrarán automáticamente aquí.
            </div>
          ) : (
            <table className={styles.logsTable}>
              <thead>
                <tr>
                  <th>Fecha y hora</th>
                  <th>Proveedor</th>
                  <th>Modelo</th>
                  <th>Estado</th>
                  <th>Latencia</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const dateStr = new Date(log.createdAt).toLocaleString("es-ES", {
                    timeZone: "Europe/Madrid",
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  return (
                    <tr key={log.id}>
                      <td>{dateStr}</td>
                      <td>
                        <span
                          className={`${styles.kpiBadge} ${
                            log.provider === "groq"
                              ? styles.badgeGroq
                              : log.provider === "openai"
                                ? styles.badgeOpenai
                                : styles.badgeFallback
                          }`}
                        >
                          {log.provider === "groq" ? "Groq" : log.provider === "openai" ? "OpenAI" : "Plantilla"}
                        </span>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{log.model}</td>
                      <td>
                        {log.status === "success" ? (
                          <span className={styles.statusSuccess}>✓ Éxito</span>
                        ) : (
                          <span className={styles.statusError} title={log.errorCode ?? "error"}>
                            ✕ Fallo ({log.errorCode ?? "error"})
                          </span>
                        )}
                      </td>
                      <td>{log.latencyMs != null ? `${log.latencyMs} ms` : "—"}</td>
                      <td>{log.totalTokens != null ? log.totalTokens.toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
