import { useEffect, useState } from "react";

/**
 * 简单的值防抖 hook
 * 用法：const debouncedSearch = useDebounce(search, 400);
 */
export function useDebounce<T>(value: T, delay: number = 400): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
