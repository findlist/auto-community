import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// vi.hoisted 提升 mock 函数避免 TDZ：vi.mock 工厂在模块加载阶段执行
const { matchSkillMock, matchTimeServiceMock, trackEventMock } = vi.hoisted(() => ({
  matchSkillMock: vi.fn(),
  matchTimeServiceMock: vi.fn(),
  trackEventMock: vi.fn().mockResolvedValue(undefined),
}));

// mock AI 推荐接口：控制 resolve/reject 与返回数据
vi.mock("@/api/ai", () => ({
  matchSkill: matchSkillMock,
  matchTimeService: matchTimeServiceMock,
}));

// mock AB 测试事件追踪：避免真实网络请求
vi.mock("@/utils/ab-test", () => ({
  trackEvent: trackEventMock,
}));

import AIRecommend from "../AIRecommend";

// 标准候选数据：覆盖昵称/信誉分/匹配度/距离/帖子全字段
const sampleCandidates = [
  {
    userId: "u1",
    nickname: "张三",
    reputationScore: 9.5,
    matchScore: 0.85,
    distance: 500,
    post: { id: "p1", title: "技能帖子1", category: "编程" },
  },
  {
    userId: "u2",
    nickname: "李四",
    reputationScore: 8.0,
    matchScore: 0.62,
    distance: 1500,
    post: { id: "p2", title: "技能帖子2", category: "设计" },
  },
];

function renderRecommend(props: Parameters<typeof AIRecommend>[0]) {
  return render(
    <MemoryRouter>
      <AIRecommend {...props} />
    </MemoryRouter>
  );
}

describe("AIRecommend AI 智能推荐组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    matchSkillMock.mockResolvedValue([]);
    matchTimeServiceMock.mockResolvedValue([]);
  });

  it("渲染默认标题「AI 智能推荐」", async () => {
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("AI 智能推荐")).toBeInTheDocument();
    });
  });

  it("渲染自定义标题", () => {
    renderRecommend({ postId: "p1", type: "skill", title: "你可能感兴趣" });
    expect(screen.getByText("你可能感兴趣")).toBeInTheDocument();
  });

  it("渲染副标题「基于语义匹配 · 距离 · 信誉」", () => {
    renderRecommend({ postId: "p1", type: "skill" });
    expect(screen.getByText("基于语义匹配 · 距离 · 信誉")).toBeInTheDocument();
  });

  it("loading 态显示「正在匹配中...」", () => {
    // 用永不 resolve 的 Promise 锁定 loading 态
    matchSkillMock.mockReturnValue(new Promise(() => {}));
    renderRecommend({ postId: "p1", type: "skill" });
    expect(screen.getByText("正在匹配中...")).toBeInTheDocument();
  });

  it("type=skill 调用 matchSkill 接口", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });
    expect(matchSkillMock).toHaveBeenCalledWith("p1");
    expect(matchTimeServiceMock).not.toHaveBeenCalled();
  });

  it("type=time-bank 调用 matchTimeService 接口", async () => {
    matchTimeServiceMock.mockResolvedValue(sampleCandidates);
    renderRecommend({ postId: "t1", type: "time-bank" });
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
    });
    expect(matchTimeServiceMock).toHaveBeenCalledWith("t1");
    expect(matchSkillMock).not.toHaveBeenCalled();
  });

  it("正常数据渲染候选卡片（含昵称/匹配度/距离）", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("张三")).toBeInTheDocument();
      expect(screen.getByText("李四")).toBeInTheDocument();
    });
    // 匹配度 0.85 → 85%
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    // 距离 500m 直接显示 m
    expect(screen.getByText("500m")).toBeInTheDocument();
    // 距离 1500m 转换为 km
    expect(screen.getByText("1.5km")).toBeInTheDocument();
  });

  it("限制最多渲染 5 个候选卡片", async () => {
    // 构造 7 个候选，验证只渲染前 5 个
    const sevenCandidates = Array.from({ length: 7 }, (_, i) => ({
      userId: `u${i}`,
      nickname: `用户${i}`,
      reputationScore: 9,
      matchScore: 0.5,
      distance: 100,
    }));
    matchSkillMock.mockResolvedValue(sevenCandidates);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("用户0")).toBeInTheDocument();
    });
    expect(screen.getByText("用户4")).toBeInTheDocument();
    // 第 6、7 个不应渲染
    expect(screen.queryByText("用户5")).toBeNull();
    expect(screen.queryByText("用户6")).toBeNull();
  });

  it("无数据时显示「暂无符合条件的推荐」", async () => {
    matchSkillMock.mockResolvedValue([]);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("暂无符合条件的推荐")).toBeInTheDocument();
    });
  });

  it("接口异常时显示「暂无推荐」错误兜底", async () => {
    matchSkillMock.mockRejectedValue(new Error("网络错误"));
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("暂无推荐")).toBeInTheDocument();
    });
  });

  it("接口异常时使用错误消息（如有 response.data.message）", async () => {
    matchSkillMock.mockRejectedValue({
      response: { data: { message: "服务暂不可用" } },
    });
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("暂无推荐")).toBeInTheDocument();
    });
  });

  it("有数据时触发 impression 事件追踪", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(trackEventMock).toHaveBeenCalledWith(
        "ai_recommendation_vs_keyword",
        "impression",
        { postId: "p1", count: 2 }
      );
    });
  });

  it("无数据时不触发 impression 事件", async () => {
    matchSkillMock.mockResolvedValue([]);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("暂无符合条件的推荐")).toBeInTheDocument();
    });
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it("渲染候选帖子标题", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("技能帖子1")).toBeInTheDocument();
      expect(screen.getByText("技能帖子2")).toBeInTheDocument();
    });
  });

  it("候选卡片渲染「查看」链接（type=skill 指向 /skills/{id}）", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    const { container } = renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      // 2 个候选都有 post，渲染 2 个「查看」链接
      expect(screen.getAllByText("查看").length).toBeGreaterThan(0);
    });
    const links = container.querySelectorAll("a");
    // 至少 1 个查看链接，href 包含 /skills/p1
    const skillLink = Array.from(links).find((l) =>
      l.getAttribute("href")?.includes("/skills/p1")
    );
    expect(skillLink).not.toBeUndefined();
  });

  it("type=time-bank 时查看链接指向 /time-bank/{id}", async () => {
    matchTimeServiceMock.mockResolvedValue([sampleCandidates[0]]);
    const { container } = renderRecommend({ postId: "t1", type: "time-bank" });
    await waitFor(() => {
      expect(screen.getByText("查看")).toBeInTheDocument();
    });
    const link = Array.from(container.querySelectorAll("a")).find((l) =>
      l.getAttribute("href")?.includes("/time-bank/p1")
    );
    expect(link).not.toBeUndefined();
  });

  it("无 post 的候选不渲染「查看」链接", async () => {
    matchSkillMock.mockResolvedValue([
      {
        userId: "u1",
        nickname: "无帖用户",
        reputationScore: 8,
        matchScore: 0.7,
        distance: 100,
      },
    ]);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("无帖用户")).toBeInTheDocument();
    });
    expect(screen.queryByText("查看")).toBeNull();
  });

  it("distance 为 null 时不渲染距离信息", async () => {
    matchSkillMock.mockResolvedValue([
      {
        userId: "u1",
        nickname: "无距离用户",
        reputationScore: 8,
        matchScore: 0.7,
        distance: null,
      },
    ]);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("无距离用户")).toBeInTheDocument();
    });
    // 不应出现数字+m/km 格式
    expect(screen.queryByText(/\d+m/)).toBeNull();
  });

  it("postId 变化触发重新拉取", async () => {
    matchSkillMock.mockResolvedValue(sampleCandidates);
    const { rerender } = renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => expect(matchSkillMock).toHaveBeenCalledWith("p1"));

    matchSkillMock.mockClear();
    matchSkillMock.mockResolvedValue([]);
    rerender(
      <MemoryRouter>
        <AIRecommend postId="p2" type="skill" />
      </MemoryRouter>
    );
    await waitFor(() => expect(matchSkillMock).toHaveBeenCalledWith("p2"));
  });

  it("信誉分渲染星级（满 5 星）", async () => {
    // reputationScore 10 → 5 星；8 → 4 星
    matchSkillMock.mockResolvedValue([
      {
        userId: "u1",
        nickname: "满星用户",
        reputationScore: 10,
        matchScore: 0.9,
        distance: 100,
      },
    ]);
    renderRecommend({ postId: "p1", type: "skill" });
    await waitFor(() => {
      expect(screen.getByText("满星用户")).toBeInTheDocument();
    });
    // 信誉分文本展示
    expect(screen.getByText("10.0")).toBeInTheDocument();
  });
});
