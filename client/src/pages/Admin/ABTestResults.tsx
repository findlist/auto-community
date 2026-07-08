import { useState, useEffect, useCallback } from "react";
import { Beaker, BarChart3, AlertTriangle, CheckCircle } from "lucide-react";
import {
  getTestConfig,
  getTestResults,
  type ABTestConfig,
  type TestResults,
} from "@/api/ab-test";

// 卡方检验：计算两组二项分布的 p-value
function chiSquareTest(
  n1: number, c1: number,
  n2: number, c2: number,
): { chiSquare: number; pValue: number; significant: boolean } {
  if (n1 === 0 || n2 === 0) {
    return { chiSquare: 0, pValue: 1, significant: false };
  }

  const total = n1 + n2;
  const totalConversions = c1 + c2;
  if (totalConversions === 0) {
    return { chiSquare: 0, pValue: 1, significant: false };
  }

  // 期望频数
  const e1 = (n1 * totalConversions) / total;
  const e2 = (n2 * totalConversions) / total;
  const e1Fail = n1 - e1;
  const e2Fail = n2 - e2;

  const observed = [c1, c2, n1 - c1, n2 - c2];
  const expected = [e1, e2, e1Fail, e2Fail];

  let chiSquare = 0;
  for (let i = 0; i < 4; i++) {
    const obs = observed[i] ?? 0;
    const exp = expected[i] ?? 0;
    if (exp > 0) {
      chiSquare += (obs - exp) ** 2 / exp;
    }
  }

  // 近似 p-value（1 自由度的卡方分布）
  const pValue = Math.exp(-0.5 * chiSquare);
  return { chiSquare, pValue, significant: pValue < 0.05 };
}

// 格式化百分比
function formatRate(value: number): string {
  return `${value.toFixed(2)}%`;
}

// 格式化日期
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

// 状态标签颜色
function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-700";
    case "paused":
      return "bg-amber-100 text-amber-700";
    case "completed":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-500";
  }
}

// 状态标签文本
function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "进行中";
    case "paused":
      return "已暂停";
    case "completed":
      return "已结束";
    default:
      return status;
  }
}

export default function ABTestResults() {
  const [config, setConfig] = useState<ABTestConfig | null>(null);
  const [results, setResults] = useState<TestResults | null>(null);
  const [loading, setLoading] = useState(true);
  // 分离配置与结果的错误状态，避免并行加载时互相覆盖
  // 设计原因：Promise.all 在任一请求 reject 时整体 reject，先成功的请求结果无法落地；
  // 分离 error 后两路加载各自独立 try/catch，成功数据正常落地，失败数据展示对应错误
  const [configError, setConfigError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  // 派生合并错误：配置错误优先展示（无配置则测试信息卡片无法渲染，更关键）
  const error = configError ?? resultsError;

  const loadConfig = useCallback(async () => {
    try {
      const res = await getTestConfig("ai_recommendation_vs_keyword");
      setConfig(res.data);
      setConfigError(null);
    } catch (err: any) {
      setConfigError(err?.response?.data?.message || "加载测试配置失败");
    }
  }, []);

  const loadResults = useCallback(async () => {
    try {
      const res = await getTestResults("ai_recommendation_vs_keyword");
      setResults(res.data);
      setResultsError(null);
    } catch (err: any) {
      setResultsError(err?.response?.data?.message || "加载测试结果失败");
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    // 重试前清空两路错误状态，让用户在加载期间看到干净界面
    setConfigError(null);
    setResultsError(null);
    // 并发加载，两路各自独立 try/catch 互不覆盖，finally 控制 loading
    await Promise.all([loadConfig(), loadResults()]).finally(() => setLoading(false));
  }, [loadConfig, loadResults]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[var(--color-text-tertiary)]">加载中...</div>
      </div>
    );
  }

  // 错误条：非阻塞展示，与已成功加载的内容并存（如配置失败但结果成功，仍展示结果表格）
  // 设计原因：原版任一失败即整体 return 错误页，导致成功数据被丢弃；改为错误条 + 条件渲染更合理
  const errorBanner = error ? (
    <div className="flex flex-col items-center justify-center gap-3 py-8 bg-red-50 rounded-2xl border border-red-200">
      <AlertTriangle className="w-8 h-8 text-[var(--color-warning)]" />
      <p className="text-[var(--color-text-secondary)]">{error}</p>
      <button
        onClick={loadData}
        className="px-4 py-2 text-sm bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] transition-colors"
      >
        重试
      </button>
    </div>
  ) : null;

  // 获取各变体数据
  const controlData = results?.variants.find((v) => v.variant === "control");
  const treatmentData = results?.variants.find((v) => v.variant === "treatment");

  const controlImpressions = controlData?.eventCounts["impression"] || 0;
  const controlClicks = controlData?.eventCounts["click"] || 0;
  const controlConversions = controlData?.eventCounts["conversion"] || 0;

  const treatmentImpressions = treatmentData?.eventCounts["impression"] || 0;
  const treatmentClicks = treatmentData?.eventCounts["click"] || 0;
  const treatmentConversions = treatmentData?.eventCounts["conversion"] || 0;

  const controlCTR = controlImpressions > 0
    ? Math.round((controlClicks / controlImpressions) * 10000) / 100
    : 0;
  const treatmentCTR = treatmentImpressions > 0
    ? Math.round((treatmentClicks / treatmentImpressions) * 10000) / 100
    : 0;

  const controlCVR = controlData?.conversionRate || 0;
  const treatmentCVR = treatmentData?.conversionRate || 0;

  // 卡方检验：点击率对比
  const ctrTest = chiSquareTest(
    controlImpressions, controlClicks,
    treatmentImpressions, treatmentClicks,
  );

  // 卡方检验：转化率对比
  const cvrTest = chiSquareTest(
    controlImpressions, controlConversions,
    treatmentImpressions, treatmentConversions,
  );

  // 生成结论
  const conclusion = generateConclusion(
    controlCTR, treatmentCTR, ctrTest,
    controlCVR, treatmentCVR, cvrTest,
    controlImpressions + treatmentImpressions,
  );

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-3">
        <Beaker className="w-6 h-6 text-[var(--color-primary-600)]" />
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
          A/B 测试结果
        </h1>
      </div>

      {/* 错误条：非阻塞展示，与已成功加载的内容并存 */}
      {errorBanner}

      {/* 测试信息卡片 */}
      {config && (
        <div className="bg-white rounded-2xl border border-[var(--color-border)] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
              {config.testName}
            </h2>
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusBadgeClass(config.status)}`}
            >
              {statusLabel(config.status)}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {config.description || "AI 推荐算法对比测试：类别匹配 vs 完整 AI 匹配"}
          </p>
          <div className="flex items-center gap-6 text-xs text-[var(--color-text-tertiary)]">
            <span>开始时间：{formatDate(config.startDate)}</span>
            <span>参与者：{results?.totalParticipants || 0} 人</span>
            <span>
              变体分配：
              {Object.entries(config.variants)
                .map(([k, v]) => `${k} ${v}%`)
                .join(" / ")}
            </span>
          </div>
        </div>
      )}

      {/* 结果对比表格：仅 results 加载成功时渲染，失败时由 errorBanner 提示 */}
      {results && (
        <>
          <div className="bg-white rounded-2xl border border-[var(--color-border)] overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--color-border)]">
              <BarChart3 className="w-4 h-4 text-[var(--color-text-tertiary)]" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                变体对比
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-neutral-50)]">
                    <th className="px-5 py-3 text-left font-medium text-[var(--color-text-secondary)]">
                      变体
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
                      曝光数
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
                      点击数
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
                      转化数
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
                      点击率
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-[var(--color-text-secondary)]">
                      转化率
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[var(--color-border)]">
                    <td className="px-5 py-3">
                      <span className="inline-block w-3 h-3 rounded-full bg-gray-400 mr-2 align-middle" />
                      <span className="font-medium text-[var(--color-text-primary)]">
                        Control（类别匹配）
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{controlImpressions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{controlClicks}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{controlConversions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatRate(controlCTR)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatRate(controlCVR)}</td>
                  </tr>
                  <tr>
                    <td className="px-5 py-3">
                      <span className="inline-block w-3 h-3 rounded-full bg-[var(--color-primary-500)] mr-2 align-middle" />
                      <span className="font-medium text-[var(--color-text-primary)]">
                        Treatment（AI 匹配）
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{treatmentImpressions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{treatmentClicks}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{treatmentConversions}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatRate(treatmentCTR)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatRate(treatmentCVR)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 统计显著性 */}
          <div className="bg-white rounded-2xl border border-[var(--color-border)] p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              统计显著性（卡方检验）
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SignificanceCard
                label="点击率差异"
                chiSquare={ctrTest.chiSquare}
                pValue={ctrTest.pValue}
                significant={ctrTest.significant}
              />
              <SignificanceCard
                label="转化率差异"
                chiSquare={cvrTest.chiSquare}
                pValue={cvrTest.pValue}
                significant={cvrTest.significant}
              />
            </div>
          </div>

          {/* 结论建议 */}
          <div className="bg-white rounded-2xl border border-[var(--color-border)] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[var(--color-success)]" />
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                结论与建议
              </h3>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
              {conclusion}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// 统计显著性卡片组件
function SignificanceCard({
  label,
  chiSquare,
  pValue,
  significant,
}: {
  label: string;
  chiSquare: number;
  pValue: number;
  significant: boolean;
}) {
  return (
    <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-neutral-50)]">
      <div className="text-xs text-[var(--color-text-tertiary)] mb-2">{label}</div>
      <div className="flex items-center gap-3">
        <span
          className={`text-lg font-bold ${
            significant ? "text-[var(--color-success)]" : "text-[var(--color-text-tertiary)]"
          }`}
        >
          {significant ? "显著" : "不显著"}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            significant
              ? "bg-emerald-100 text-emerald-700"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          p = {pValue < 0.001 ? "<0.001" : pValue.toFixed(4)}
        </span>
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
        χ² = {chiSquare.toFixed(2)}
      </div>
    </div>
  );
}

// 生成结论建议
function generateConclusion(
  controlCTR: number,
  treatmentCTR: number,
  ctrTest: { significant: boolean },
  controlCVR: number,
  treatmentCVR: number,
  cvrTest: { significant: boolean },
  totalImpressions: number,
): string {
  if (totalImpressions < 100) {
    return "当前样本量不足（< 100 次曝光），建议继续收集数据后再做判断。统计检验需要足够的样本量才能得出可靠结论。";
  }

  const parts: string[] = [];

  // 点击率结论
  if (ctrTest.significant) {
    if (treatmentCTR > controlCTR) {
      const lift = ((treatmentCTR - controlCTR) / controlCTR * 100).toFixed(1);
      parts.push(`AI 匹配（Treatment）的点击率显著高于类别匹配（Control），提升 ${lift}%。`);
    } else {
      const drop = ((controlCTR - treatmentCTR) / controlCTR * 100).toFixed(1);
      parts.push(`类别匹配（Control）的点击率显著高于 AI 匹配（Treatment），降低 ${drop}%。`);
    }
  } else {
    parts.push("两种算法在点击率上无统计显著差异。");
  }

  // 转化率结论
  if (cvrTest.significant) {
    if (treatmentCVR > controlCVR) {
      parts.push("AI 匹配在转化率上同样表现更优，建议全量开启 AI 推荐。");
    } else {
      parts.push("类别匹配在转化率上表现更优，建议评估 AI 匹配的成本效益。");
    }
  } else {
    parts.push("转化率差异暂不显著。");
  }

  // 建议
  if (!ctrTest.significant && !cvrTest.significant) {
    parts.push("建议增加测试流量或延长测试周期以获取更多数据。");
  }

  return parts.join(" ");
}
