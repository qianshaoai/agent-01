import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SearchX } from "lucide-react";

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fc] p-4">
      <div className="bg-white rounded-[20px] shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-10 max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-full bg-[#f0f4ff] flex items-center justify-center mx-auto mb-4">
          <SearchX size={28} className="text-[#002FA7]" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-2">页面不存在</h2>
        <p className="text-sm text-gray-500 mb-6">你访问的页面不存在或已被移除。</p>
        <Link href="/">
          <Button>返回首页</Button>
        </Link>
      </div>
    </div>
  );
}
