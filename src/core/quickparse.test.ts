import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quickparse";

// 2026-01-14 是周三
const NOW = new Date(2026, 0, 14, 12, 0);

describe("parseQuickAdd", () => {
  it("完整组合：日期 + 标题 + 列表 + 优先级", () => {
    expect(parseQuickAdd("明天 交报告 #工作 !高", NOW)).toEqual({
      title: "交报告",
      dueDate: "2026-01-15",
      priority: 3,
      listQuery: "工作",
    });
  });

  it("周X 解析到本周", () => {
    expect(parseQuickAdd("周五 开会", NOW).dueDate).toBe("2026-01-16");
    expect(parseQuickAdd("周一 晨会", NOW).dueDate).toBe("2026-01-19"); // 已过 -> 下周一
    expect(parseQuickAdd("周三 复盘", NOW).dueDate).toBe("2026-01-14"); // 今天
  });

  it("下周X 解析到下一个自然周", () => {
    expect(parseQuickAdd("下周三 复盘", NOW).dueDate).toBe("2026-01-21");
    expect(parseQuickAdd("下周一 启动", NOW).dueDate).toBe("2026-01-19");
  });

  it("日期词可无空格紧跟中文", () => {
    const r = parseQuickAdd("明天交报告", NOW);
    expect(r.dueDate).toBe("2026-01-15");
    expect(r.title).toBe("交报告");
  });

  it("具体日期 M月D日 / M/D，已过去自动顺延一年", () => {
    expect(parseQuickAdd("3月8日 回家", NOW).dueDate).toBe("2026-03-08");
    expect(parseQuickAdd("1月3日 聚会", NOW).dueDate).toBe("2027-01-03");
    expect(parseQuickAdd("3/8 回家", NOW).dueDate).toBe("2026-03-08");
    expect(parseQuickAdd("12-25 圣诞", NOW).dueDate).toBe("2026-12-25");
  });

  it("显式年份：2026/10/8、2026-10-8、2026年10月8日、2026.10.8", () => {
    expect(parseQuickAdd("2026/10/8 体检", NOW).dueDate).toBe("2026-10-08");
    expect(parseQuickAdd("2026-10-08 复查", NOW).dueDate).toBe("2026-10-08");
    expect(parseQuickAdd("2026年10月8日 体检", NOW).dueDate).toBe("2026-10-08");
    expect(parseQuickAdd("2026.10.8 体检", NOW).dueDate).toBe("2026-10-08");
  });

  it("写了年份就按所写年份，不再自动顺延", () => {
    // NOW=2026-01-14：无年份的 1月3日 顺延到 2027；带 2026 则保持在 2026
    expect(parseQuickAdd("2026/1/3 聚会", NOW).dueDate).toBe("2026-01-03");
  });

  it("不存在的日期不误判（2月30日 保持原词）", () => {
    const r = parseQuickAdd("2月30日 复盘", NOW);
    expect(r.dueDate).toBeUndefined();
    expect(r.title).toBe("2月30日 复盘");
  });

  it("今天/明天/后天/大后天", () => {
    expect(parseQuickAdd("今天 洗衣服", NOW).dueDate).toBe("2026-01-14");
    expect(parseQuickAdd("明天 取快递", NOW).dueDate).toBe("2026-01-15");
    expect(parseQuickAdd("后天 体检", NOW).dueDate).toBe("2026-01-16");
    expect(parseQuickAdd("大后天 出发", NOW).dueDate).toBe("2026-01-17");
  });

  it("优先级：!!! / !! / ! 与 !高 !中 !低", () => {
    expect(parseQuickAdd("任务 !!!", NOW).priority).toBe(3);
    expect(parseQuickAdd("任务 !!", NOW).priority).toBe(2);
    expect(parseQuickAdd("任务 !", NOW).priority).toBe(1);
    expect(parseQuickAdd("!! 紧急事项", NOW).priority).toBe(2);
    expect(parseQuickAdd("任务 !中", NOW).priority).toBe(2);
    expect(parseQuickAdd("任务 !低", NOW).priority).toBe(1);
  });

  it("无标记时原样返回", () => {
    const r = parseQuickAdd("随便写点什么", NOW);
    expect(r).toEqual({ title: "随便写点什么", dueDate: undefined, priority: undefined, listQuery: undefined });
  });

  it("优先级与列表记号兼容全角 ！ ＃（中文输入法免切换）", () => {
    expect(parseQuickAdd("任务 ！高", NOW).priority).toBe(3);
    expect(parseQuickAdd("任务 ！中", NOW).priority).toBe(2);
    expect(parseQuickAdd("任务 ！低", NOW).priority).toBe(1);
    expect(parseQuickAdd("！！！ 紧急事项", NOW).priority).toBe(3);
    expect(parseQuickAdd("任务 ！！", NOW).priority).toBe(2);
    expect(parseQuickAdd("买菜 ＃购物清单", NOW).listQuery).toBe("购物清单");
    // 中英混用也行
    const r = parseQuickAdd("明天 交报告 #工作 ！高", NOW);
    expect(r).toMatchObject({
      title: "交报告",
      dueDate: "2026-01-15",
      priority: 3,
      listQuery: "工作",
    });
  });

  it("#列表名 需要 token 形式", () => {
    expect(parseQuickAdd("买东西 #购物清单", NOW).listQuery).toBe("购物清单");
    // 标题中间的 # 不会被误判
    const r = parseQuickAdd("学习 C# 入门", NOW);
    expect(r.title).toBe("学习 C# 入门");
    expect(r.listQuery).toBeUndefined();
  });
});
