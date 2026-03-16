import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// 公开接口：前台页面读取品牌配置（logo、平台名称）
export async function GET() {
  try {
    const { data } = await db
      .from("system_settings")
      .select("key, value")
      .in("key", ["logo_url", "platform_name", "help_doc_url"]);

    const map: Record<string, string> = {};
    for (const row of data ?? []) {
      map[row.key] = row.value;
    }

    return NextResponse.json({
      logo_url: map.logo_url ?? "",
      platform_name: map.platform_name ?? "前哨AI人机协同工作舱",
      help_doc_url: map.help_doc_url ?? "",
    });
  } catch {
    // 表不存在时（迁移未执行）返回默认值，避免前台报错
    return NextResponse.json({
      logo_url: "",
      platform_name: "AI 智能体平台",
      help_doc_url: "",
    });
  }
}
