import { Link, useNavigate } from "react-router-dom";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 text-center">
      <div className="mb-6 select-none">
        <span className="text-[120px] sm:text-[160px] font-extrabold leading-none bg-gradient-to-br from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
          404
        </span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-3">
        页面走丢了
      </h1>

      <p className="text-gray-500 mb-8 max-w-md">
        您访问的页面不存在或已被移除
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          to="/"
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-full font-medium hover:bg-emerald-600 transition-colors"
        >
          <Home className="w-4 h-4" />
          返回首页
        </Link>

        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 border border-gray-300 text-gray-700 rounded-full font-medium hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回上一页
        </button>
      </div>
    </div>
  );
}
