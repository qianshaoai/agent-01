"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fc] p-4">
      <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-10 max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} className="text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">页面出错了</h2>
        <p className="text-sm text-gray-500 mb-6">
          {error.message || "发生了未知错误，请重试或联系管理员。"}
        </p>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => (window.location.href = "/")}>
            返回首页
          </Button>
          <Button onClick={reset}>重试</Button>
        </div>
      </div>
    </div>
  );
}
