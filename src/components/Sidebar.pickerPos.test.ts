import { describe, expect, it } from "vitest";
import { pickerPos } from "./Sidebar";

/** 断言落点完全落在视口内（即弹层不会被屏幕边缘裁掉） */
function expectInsideViewport(
  pos: { left: number; top: number },
  pw: number,
  ph: number,
  vw: number,
  vh: number,
) {
  expect(pos.left).toBeGreaterThanOrEqual(8);
  expect(pos.top).toBeGreaterThanOrEqual(8);
  expect(pos.left + pw).toBeLessThanOrEqual(vw - 8);
  expect(pos.top + ph).toBeLessThanOrEqual(vh - 8);
}

describe("pickerPos — 外观弹层视口内定位", () => {
  it("回归：手机(360×800)侧栏抽屉内，右侧放不下时翻到左侧并钳制在视口内", () => {
    // 触发行在抽屉里（右缘 288 = 抽屉宽），弹层 288×246（移动端尺寸）
    const pos = pickerPos(
      { left: 8, top: 300, right: 288, bottom: 330 },
      288,
      246,
      360,
      800,
    );
    expectInsideViewport(pos, 288, 246, 360, 800);
    expect(pos.left).toBe(8); // 翻左失败后钳制到最小边距
    expect(pos.top).toBe(300); // 垂直方向仍顶对齐行
  });

  it("极窄屏(320)同样不溢出", () => {
    const pos = pickerPos(
      { left: 8, top: 300, right: 288, bottom: 330 },
      288,
      246,
      320,
      640,
    );
    expectInsideViewport(pos, 288, 246, 320, 640);
  });

  it("桌面端：贴行右侧、顶对齐，不翻转", () => {
    const pos = pickerPos(
      { left: 8, top: 200, right: 288, bottom: 230 },
      240,
      230,
      1280,
      800,
    );
    expect(pos).toEqual({ left: 296, top: 200 });
  });

  it("行靠近屏幕底部时底对齐行，不放到视口外", () => {
    const pos = pickerPos(
      { left: 8, top: 700, right: 288, bottom: 730 },
      240,
      230,
      1280,
      800,
    );
    expectInsideViewport(pos, 240, 230, 1280, 800);
    expect(pos.top).toBe(500); // 730 - 230
  });

  it("无锚点时居中兜底且在视口内", () => {
    const pos = pickerPos(null, 288, 246, 800, 600);
    expect(pos).toEqual({ left: (800 - 288) / 2, top: (600 - 246) / 2 });
  });
});
