"use client";
import { useEffect } from "react";

// 6.1up R1.5 · scale-to-fit · 整页 zoom 缩放
// 基准设计宽度 1920（按 admin 实测 2026-06-01 屏幕分辨率）。
// 窄屏（< 1920）等比缩小到 viewport，宽屏（>= 1920）按 1.0 显示。
// 目标：不同分辨率视觉一致 + 禁止横向滚动。
//
// 注：初始 zoom 在 [`app/layout.tsx`](../app/layout.tsx) pre-hydration
// script 里同步设置（避免 FOUC）。本组件只负责监听 resize 后续更新。
//
// 历史：5.7up 曾用 zoom 做字体大小切换、后弃用（globals.css:64 注释）。
// 5.7up 弃用是「用 zoom 做字体局部缩放」场景错配，6.1up 用 zoom 做
// 「整页等比缩放」是 zoom 的本意，无冲突。

const DESIGN_WIDTH = 1920;

export function ZoomFit() {
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const z = Math.min(1, w / DESIGN_WIDTH);
      // 用 html.style.zoom 而非 body（影响 dvh / scrollbar 等计算）
      (document.documentElement.style as { zoom?: string }).zoom = String(z);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return null;
}
