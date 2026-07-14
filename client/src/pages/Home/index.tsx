import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import client from "@/api/client";
import type { ApiResponse } from "@/types";
import { useScrollReveal } from "@/hooks/useScrollReveal";

interface PublicStats {
  totalUsers: number;
  totalMutualAids: number;
}

// 四大模块：编辑式编号列表，每个模块一个主色点 + 一句承诺
const modules = [
  {
    no: "01",
    title: "技能交换",
    desc: "用你擅长的事，换邻里擅长的事。",
    path: "/skills",
    accent: "#3b82f6",
  },
  {
    no: "02",
    title: "共享厨房",
    desc: "一锅好汤，可以喂饱一整栋楼。",
    path: "/kitchen",
    accent: "#f97316",
  },
  {
    no: "03",
    title: "时间银行",
    desc: "今天存下的一小时，明天变成家人的照护。",
    path: "/time-bank",
    accent: "#8b5cf6",
  },
  {
    no: "04",
    title: "应急邻里",
    desc: "紧急时刻，最近的帮助就在隔壁。",
    path: "/emergency",
    accent: "#ef4444",
  },
];

function formatCount(num: number): string {
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, "")}w+`;
  if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}k+`;
  return `${num}+`;
}

// 模块列表项：悬停时整体右移、显现箭头、左侧色条延展
function ModuleRow({
  no,
  title,
  desc,
  path,
  accent,
  delay,
}: {
  no: string;
  title: string;
  desc: string;
  path: string;
  accent: string;
  delay: number;
}) {
  const { ref, visible } = useScrollReveal<HTMLAnchorElement>();
  return (
    <Link
      ref={ref}
      to={path}
      className="group block border-t border-neutral-200 last:border-b py-6 lg:py-8 transition-all duration-500"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transitionDelay: `${delay}ms`,
        transitionProperty: "opacity, transform",
      }}
    >
      <div className="flex items-start gap-5 lg:gap-8">
        {/* 编号 + 色条 */}
        <div className="relative flex-shrink-0 w-12 lg:w-16 pt-1">
          <span
            className="block h-px mb-2 transition-all duration-500 group-hover:w-full"
            style={{
              width: 24,
              backgroundColor: accent,
            }}
          />
          <span className="font-mono text-xs lg:text-sm text-neutral-400 tracking-wider group-hover:text-neutral-600 transition-colors">
            {no}
          </span>
        </div>
        {/* 标题 + 描述 */}
        <div className="flex-1 min-w-0">
          <h3 className="text-2xl lg:text-4xl font-semibold text-neutral-900 mb-1.5 lg:mb-2 tracking-tight transition-transform duration-500 group-hover:translate-x-2">
            {title}
          </h3>
          <p className="text-sm lg:text-base text-neutral-500 leading-relaxed">
            {desc}
          </p>
        </div>
        {/* 悬停显现的箭头 */}
        <ArrowUpRight
          className="flex-shrink-0 w-5 h-5 lg:w-7 lg:h-7 text-neutral-900 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-500 mt-1"
          aria-hidden
        />
      </div>
    </Link>
  );
}

export default function Home() {
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [totalMutualAids, setTotalMutualAids] = useState<number | null>(null);
  // 统计加载失败标志：区分"加载中"（null + 无 error）与"加载失败"（null + error）
  const [statsError, setStatsError] = useState(false);
  // 首页 Hero 图：默认使用本地 llq.jpg，管理员配置后覆盖
  const [heroImage, setHeroImage] = useState<string>("/llq.jpg");
  const { ref: proofRef, visible: proofVisible } = useScrollReveal<HTMLDivElement>();
  const { ref: ctaRef, visible: ctaVisible } = useScrollReveal<HTMLDivElement>();

  useEffect(() => {
    client
      .get<never, ApiResponse<PublicStats>>("/public/stats")
      .then((res) => {
        setTotalUsers(res.data.totalUsers);
        setTotalMutualAids(res.data.totalMutualAids);
      })
      .catch((err) => {
        console.error("加载首页统计失败:", err);
        setStatsError(true);
      });
    // 拉取管理员配置的首页展示图片，未配置时保持默认图
    client
      .get<never, ApiResponse<{ url: string | null }>>("/public/homepage-image")
      .then((res) => {
        if (res.data.url) setHeroImage(res.data.url);
      })
      .catch((err) => console.error("加载首页图片失败:", err));
  }, []);

  // 加载失败时显示"—"，与加载中的"——"区分（加载失败用单个短横线 + title 提示）
  const usersText = totalUsers !== null ? formatCount(totalUsers) : statsError ? "—" : "——";
  const aidsText = totalMutualAids !== null ? formatCount(totalMutualAids) : statsError ? "—" : "——";

  return (
    <div className="bg-white">
      {/* ============ Hero：全幅图像 + 品牌字标为最响 ============ */}
      <section className="relative w-full min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] overflow-hidden">
        {/* 全幅背景图：温暖邻里场景 */}
        <img
          src={heroImage}
          alt="邻里在金色时刻的院子里相聚"
          className="absolute inset-0 w-full h-full object-cover scale-105 animate-hero-img"
          loading="eager"
        />
        {/* 暗角渐变：确保左侧文字区有稳定对比 */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-black/10 lg:from-black/65 lg:via-black/35 lg:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        {/* 文字列：左对齐，约束宽度，垂直居中 */}
        <div className="relative h-full max-w-6xl mx-auto px-6 lg:px-10 flex flex-col justify-end pb-16 lg:pb-24 pt-20">
          <div className="max-w-xl">
            {/* 小标签 */}
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs text-white/90 mb-6 animate-fade-in-up"
              style={{ animationDelay: "60ms" }}
            >
              <Sparkles className="w-3 h-3" />
              AI 驱动的社区互助平台
            </div>

            {/* 品牌字标：全页最响 */}
            <h1
              className="text-white font-bold tracking-tight leading-[0.95] animate-fade-in-up mb-4 text-balance drop-shadow-sm"
              style={{
                fontSize: "clamp(3rem, 12vw, 7rem)",
                animationDelay: "120ms",
              }}
            >
              邻里圈
            </h1>

            {/* 承诺句 */}
            <p
              className="text-white/95 text-lg lg:text-2xl font-light leading-snug mb-2 animate-fade-in-up"
              style={{ animationDelay: "200ms" }}
            >
              让社区，重新有温度。
            </p>
            <p
              className="text-white/70 text-sm lg:text-base mb-8 animate-fade-in-up"
              style={{ animationDelay: "260ms" }}
            >
              一个平台，四种连接 —— 重建邻里互助的美好时光。
            </p>

            {/* CTA */}
            <div
              className="flex flex-wrap items-center gap-3 animate-fade-in-up"
              style={{ animationDelay: "320ms" }}
            >
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 hover:gap-3 transition-all duration-300"
              >
                立即体验
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-transparent border border-white/40 text-white text-sm font-medium hover:bg-white/10 transition-all duration-300"
              >
                注册账号
              </Link>
            </div>
          </div>
        </div>

        {/* 底部滚动提示 */}
        <div className="absolute bottom-6 right-6 hidden lg:flex items-center gap-2 text-white/60 text-xs animate-fade-in" style={{ animationDelay: "600ms" }}>
          <span className="tracking-widest">SCROLL</span>
          <span className="w-8 h-px bg-white/40" />
        </div>
      </section>

      {/* ============ 数据证明：内联编辑式，非卡片条 ============ */}
      <section ref={proofRef} className="py-16 lg:py-24 px-6 lg:px-10">
        <div
          className="max-w-6xl mx-auto transition-all duration-700"
          style={{
            opacity: proofVisible ? 1 : 0,
            transform: proofVisible ? "translateY(0)" : "translateY(24px)",
          }}
        >
          <p className="text-xs tracking-widest text-neutral-400 mb-4 font-mono">
            —— 此时此刻
          </p>
          <div className="flex flex-col lg:flex-row lg:items-end gap-8 lg:gap-16">
            <div>
              <div className="text-5xl lg:text-7xl font-semibold text-neutral-900 tracking-tight tabular-nums">
                {usersText}
              </div>
              <div className="text-sm text-neutral-500 mt-2">已注册邻居</div>
            </div>
            <div className="hidden lg:block w-px h-16 bg-neutral-200" />
            <div>
              <div className="text-5xl lg:text-7xl font-semibold text-neutral-900 tracking-tight tabular-nums">
                {aidsText}
              </div>
              <div className="text-sm text-neutral-500 mt-2">完成互助</div>
            </div>
            <div className="hidden lg:block w-px h-16 bg-neutral-200" />
            <div className="lg:pb-3">
              <div className="text-2xl lg:text-3xl font-semibold text-neutral-900 tracking-tight">
                语义 · 距离 · 信誉
              </div>
              <div className="text-sm text-neutral-500 mt-2">AI 三维智能匹配</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ 四大模块：编辑式编号列表 ============ */}
      <section className="py-12 lg:py-20 px-6 lg:px-10 bg-neutral-50">
        <div className="max-w-6xl mx-auto">
          {/* 章节标题 */}
          <div className="mb-10 lg:mb-14 max-w-2xl">
            <p className="text-xs tracking-widest text-neutral-400 mb-3 font-mono">
              —— 核心服务
            </p>
            <h2 className="text-3xl lg:text-5xl font-semibold text-neutral-900 tracking-tight leading-tight text-balance">
              四种方式，
              <br />
              重新连接邻里。
            </h2>
          </div>

          {/* 编号列表 */}
          <div>
            {modules.map((m, i) => (
              <ModuleRow key={m.path} {...m} delay={i * 80} />
            ))}
          </div>
        </div>
      </section>

      {/* ============ 终极 CTA ============ */}
      <section ref={ctaRef} className="py-20 lg:py-32 px-6 lg:px-10 bg-neutral-900 text-white relative overflow-hidden">
        {/* 微妙的光晕，唯一装饰 */}
        <div className="absolute top-1/2 -right-32 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div
          className="relative max-w-3xl mx-auto text-center transition-all duration-700"
          style={{
            opacity: ctaVisible ? 1 : 0,
            transform: ctaVisible ? "translateY(0)" : "translateY(24px)",
          }}
        >
          <h2 className="text-4xl lg:text-6xl font-semibold tracking-tight mb-5 leading-tight text-balance">
            最好的邻居，
            <br />
            从来都是第一次见面。
          </h2>
          <p className="text-white/60 text-base lg:text-lg mb-10 max-w-xl mx-auto">
            加入邻里圈，让下一次敲门，不再只是收快递。
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-neutral-900 text-base font-semibold hover:gap-3 transition-all duration-300"
          >
            免费注册
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* 页脚版权 */}
      <footer className="py-8 px-6 text-center bg-neutral-900 text-neutral-500 text-xs">
        © 邻里圈 · 让社区更有温度
      </footer>
    </div>
  );
}
