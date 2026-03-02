import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const formData = await req.formData();
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile) {
    return NextResponse.json({ error: "请提供音频文件" }, { status: 400 });
  }

  const appId = process.env.VOLCENGINE_APP_ID;
  const token = process.env.VOLCENGINE_ACCESS_TOKEN;

  if (!appId || !token) {
    // 语音识别未配置，返回提示
    return NextResponse.json(
      { error: "语音识别服务暂未配置，请联系管理员" },
      { status: 501 }
    );
  }

  try {
    const bytes = await audioFile.arrayBuffer();

    // 火山引擎（豆包）ASR API
    const res = await fetch(
      `https://openspeech.bytedance.com/api/v1/asr/submit?appid=${appId}&token=${token}&version=v2&format=mp3&bits=16&rate=16000&encoding=raw&model_name=general`,
      {
        method: "POST",
        headers: { "Content-Type": "audio/mp3" },
        body: bytes,
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "语音识别失败" }, { status: 502 });
    }

    const result = await res.json();
    const text = result?.result?.text ?? result?.result?.[0]?.text ?? "";

    return NextResponse.json({ ok: true, text });
  } catch (e) {
    console.error("[speech]", e);
    return NextResponse.json({ error: "语音识别服务错误" }, { status: 500 });
  }
}
