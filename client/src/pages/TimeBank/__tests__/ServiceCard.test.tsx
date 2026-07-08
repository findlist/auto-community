import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ServiceCard from "@/pages/TimeBank/ServiceCard";
import type { TimeService, User } from "@/types";

// 构造可控 User 对象，减少重复样板
const buildUser = (overrides: Partial<User> = {}): User => ({
  id: "user-1",
  phone: "13800000000",
  nickname: "热心邻居",
  creditBalance: 100,
  timeBalance: 60,
  reputationScore: 5,
  role: "user",
  // createdAt 必填：User 接口要求为 string，提供默认值避免类型不匹配
  createdAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

// 构造可控 TimeService 对象，默认 provide 类型完整字段
const buildService = (overrides: Partial<TimeService> = {}): TimeService => ({
  id: "svc-1",
  userId: "user-1",
  type: "provide",
  title: "上门理发服务",
  description: "10 年理发经验，上门服务",
  category: "生活服务",
  durationMinutes: 60,
  location: "社区活动中心",
  address: "幸福小区 3 栋",
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("ServiceCard 时间银行服务列表项", () => {
  it("渲染服务标题、描述、分类", () => {
    render(<ServiceCard service={buildService()} />);
    expect(screen.getByText("上门理发服务")).toBeInTheDocument();
    expect(screen.getByText("10 年理发经验，上门服务")).toBeInTheDocument();
    expect(screen.getByText("生活服务")).toBeInTheDocument();
  });

  it("type=provide 时显示「提供」标签与 emerald 竖条", () => {
    const { container } = render(<ServiceCard service={buildService({ type: "provide" })} />);
    expect(screen.getByText("提供")).toBeInTheDocument();
    // 竖条 span 元素 class 含 bg-emerald-500
    const bar = container.querySelector("span.block.w-1.h-12");
    expect(bar?.className).toContain("bg-emerald-500");
  });

  it("type=request 时显示「需求」标签与 violet 竖条", () => {
    const { container } = render(<ServiceCard service={buildService({ type: "request" })} />);
    expect(screen.getByText("需求")).toBeInTheDocument();
    const bar = container.querySelector("span.block.w-1.h-12");
    expect(bar?.className).toContain("bg-violet-500");
  });

  it("durationMinutes=60 时 formatTime 转换为「1小时」", () => {
    render(<ServiceCard service={buildService({ durationMinutes: 60 })} />);
    expect(screen.getByText("1小时")).toBeInTheDocument();
  });

  it("durationMinutes=90 时 formatTime 转换为「1小时30分钟」（非整小时分支）", () => {
    render(<ServiceCard service={buildService({ durationMinutes: 90 })} />);
    expect(screen.getByText("1小时30分钟")).toBeInTheDocument();
  });

  it("durationMinutes=30 时 formatTime 转换为「30分钟」（<60 分钟分支）", () => {
    render(<ServiceCard service={buildService({ durationMinutes: 30 })} />);
    expect(screen.getByText("30分钟")).toBeInTheDocument();
  });

  it("location 存在时显示 location（优先于 address）", () => {
    render(<ServiceCard service={buildService({ location: "社区活动中心", address: "幸福小区 3 栋" })} />);
    // location 优先显示
    expect(screen.getByText("社区活动中心")).toBeInTheDocument();
    // address 不应显示
    expect(screen.queryByText("幸福小区 3 栋")).not.toBeInTheDocument();
  });

  it("location 为空但 address 存在时显示 address", () => {
    render(<ServiceCard service={buildService({ location: undefined, address: "幸福小区 3 栋" })} />);
    expect(screen.getByText("幸福小区 3 栋")).toBeInTheDocument();
  });

  it("location 与 address 均为空时不显示位置信息", () => {
    render(<ServiceCard service={buildService({ location: undefined, address: undefined })} />);
    // MapPin 图标对应的位置 span 不应出现，通过查询「幸福小区」确认不存在
    expect(screen.queryByText("社区活动中心")).not.toBeInTheDocument();
    expect(screen.queryByText("幸福小区 3 栋")).not.toBeInTheDocument();
  });

  it("user.nickname 存在时显示昵称", () => {
    render(<ServiceCard service={buildService({ user: buildUser({ nickname: "张师傅" }) })} />);
    expect(screen.getByText("张师傅")).toBeInTheDocument();
  });

  it("user.reputationScore 存在时显示 Star 图标与分数", () => {
    render(<ServiceCard service={buildService({ user: buildUser({ reputationScore: 4 }) }) } />);
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("user.reputationScore 为 null 时不显示分数", () => {
    // reputationScore != null 判断：null 不显示
    render(<ServiceCard service={buildService({ user: buildUser({ reputationScore: null as unknown as number }) }) } />);
    // 不应出现数字分数（注意排除时长等数字）
    // 通过验证 Star 图标后的分数不存在：reputationScore 为 null 时整个 span 不渲染
    // 用 queryByText 查找 reputationScore 对应的数字（这里用 5 验证默认值不显示）
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("user 为 undefined 时不崩溃，不显示昵称与信誉分", () => {
    // user 可选，未关联用户时不应崩溃
    render(<ServiceCard service={buildService({ user: undefined })} />);
    // 不应出现默认昵称
    expect(screen.queryByText("热心邻居")).not.toBeInTheDocument();
  });

  it("点击卡片触发 onClick 回调", () => {
    const onClick = vi.fn();
    // onClick 绑定在最外层 div，通过点击标题触发事件冒泡
    const { container } = render(<ServiceCard service={buildService()} onClick={onClick} />);
    fireEvent.click(container.firstChild as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("未传 onClick 时不崩溃（点击无副作用）", () => {
    // onClick 可选，未传时点击不应抛错
    const { container } = render(<ServiceCard service={buildService()} />);
    expect(() => fireEvent.click(container.firstChild as Element)).not.toThrow();
  });
});
