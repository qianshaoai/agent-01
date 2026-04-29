import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, requireFullUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { withRequestLog } from "@/lib/request-logger";

const SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";

function getAudioFormat(mimeType: string): { format: string; codec: string; rate: number } {
  if (mimeType.includes("mp4")) return { format: "mp4", codec: "aac", rate: 44100 };
  if (mimeType.includes("ogg")) return { format: "ogg", codec: "opus", rate: 48000 };
  if (mimeType.includes("wav")) return { format: "wav", codec: "pcm", rate: 16000 };
  if (mimeType.includes("mp3")) return { format: "mp3", codec: "mp3", rate: 16000 };
  return { format: "webm", codec: "opus", rate: 48000 }; // Chrome/Edge 默认 48kHz
}

// POST：提交识别任务，立即返回 requestId
export const POST = withRequestLog(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "语音识别服务暂未配置，请联系管理员" },
      { status: 501 }
    );
  }

  const formData = await req.formData();
  const audioFile = formData.get("audio") as File | null;
  if (!audioFile) {
    return NextResponse.json({ error: "请提供音频文件" }, { status: 400 });
  }

  try {
    // 1. 上传音频到 Supabase Storage
    const bytes = await audioFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
    const { format, codec, rate } = getAudioFormat(audioFile.type || "audio/webm");
    const audioPath = `speech-temp/${uuidv4()}.${format}`;

    const { data: uploadData, error: uploadError } = await db.storage
      .from(bucket)
      .upload(audioPath, buffer, {
        contentType: audioFile.type || "audio/webm",
        upsert: false,
      });

    if (uploadError) throw new Error("音频上传失败");

    const { data: urlData } = db.storage.from(bucket).getPublicUrl(uploadData.path);

    // 2. 提交 ASR 任务
    const requestId = uuidv4();

    const submitRes = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "X-Api-Resource-Id": "volc.seedasr.auc",
        "X-Api-Request-Id": requestId,
        "X-Api-Sequence": "-1",
      },
      body: JSON.stringify({
        user: { uid: user.phone || "portal_user" },
        audio: {
          url: urlData.publicUrl,
          format,
          codec,
          rate,
          bits: 16,
          channel: 1,
        },
        request: {
          model_name: "bigmodel",
          enable_itn: true,
          enable_punc: true,
          enable_ddc: false,
          enable_speaker_info: false,
          enable_channel_split: false,
          show_utterances: false,
          vad_segment: false,
          sensitive_words_filter: "",
        },
      }),
    });

    if (!submitRes.ok) {
      throw new Error(`提交任务失败: ${submitRes.status}`);
    }

    // audioPath 不在这里删除，等查询到结果后再清理
    return NextResponse.json({ ok: true, requestId, audioPath });
  } catch (e) {
    console.error("[speech submit]", e);
    return NextResponse.json({ error: "提交语音任务失败，请重试" }, { status: 500 });
  }
});

// GET：查询识别结果
export const GET = withRequestLog(async (req: NextRequest) => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const guard = requireFullUser(user);
  if (guard) return guard;

  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "未配置" }, { status: 501 });
  }

  const requestId = req.nextUrl.searchParams.get("requestId");
  const audioPath = req.nextUrl.searchParams.get("audioPath");
  if (!requestId) {
    return NextResponse.json({ error: "缺少 requestId" }, { status: 400 });
  }

  try {
    const queryRes = await fetch(QUERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "X-Api-Resource-Id": "volc.seedasr.auc",
        "X-Api-Request-Id": requestId,
      },
      body: JSON.stringify({}),
    });

    if (!queryRes.ok) {
      return NextResponse.json({ done: false });
    }

    const result = await queryRes.json();

    if (result?.result?.text !== undefined) {
      // 识别完成，清理临时音频文件
      if (audioPath) {
        const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
        db.storage.from(bucket).remove([audioPath]).catch((err) => console.error("[speech] failed to delete temp audio:", audioPath, err));
      }
      return NextResponse.json({ done: true, text: result.result.text ?? "" });
    }

    // 明确的错误码（非处理中）
    const code = result?.resp?.code;
    if (code && code !== 1013) {
      console.error("[speech query] error:", result);
      return NextResponse.json({ done: true, text: "", error: "识别失败" });
    }

    return NextResponse.json({ done: false });
  } catch (e) {
    console.error("[speech query]", e);
    return NextResponse.json({ done: false });
  }
});
