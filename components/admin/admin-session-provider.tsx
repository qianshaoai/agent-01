"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invalidateAdminReferenceData } from "@/lib/admin-reference-data";

export type AdminRole = "super_admin" | "system_admin" | "org_admin";
export type AdminSource = "admin_table" | "user_admin" | "custom_admin";

export type AdminMePayload = {
  source: AdminSource | null;
  adminId?: string | null;
  userId?: string | null;
  username?: string | null;
  role?: AdminRole | null;
  builtinRole?: AdminRole | null;
  tenantCode?: string | null;
  deptId?: string | null;
  teamId?: string | null;
  userType?: string | null;
  customRoleCodes?: string[];
  permissions?: string[];
};

export type AdminSiteSettings = {
  logo_url?: string;
  platform_name?: string;
  [key: string]: unknown;
};

type SessionStatus = "loading" | "ready" | "unauthenticated" | "forbidden" | "error";

type AdminSessionContextValue = {
  me: AdminMePayload | null;
  siteSettings: AdminSiteSettings;
  status: SessionStatus;
  stale: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);
const REFRESH_THROTTLE_MS = 30_000;
const EMPTY_SETTINGS: AdminSiteSettings = { logo_url: "", platform_name: "" };

function readCachedSettings(): AdminSiteSettings {
  if (typeof window === "undefined") return EMPTY_SETTINGS;
  try {
    const raw = localStorage.getItem("brand_settings_v1");
    return raw ? (JSON.parse(raw) as AdminSiteSettings) : EMPTY_SETTINGS;
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<AdminMePayload | null>(null);
  const [siteSettings, setSiteSettings] = useState<AdminSiteSettings>(EMPTY_SETTINGS);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meRef = useRef<AdminMePayload | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const lastRefreshRef = useRef(0);
  const mountedRef = useRef(false);
  const referenceScopeRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      inFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSiteSettings(readCachedSettings());
    let cancelled = false;
    fetch("/api/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((settings: AdminSiteSettings | null) => {
        if (cancelled || !settings) return;
        setSiteSettings(settings);
        try {
          localStorage.setItem("brand_settings_v1", JSON.stringify(settings));
        } catch {
          // localStorage 不可用时仅放弃跨刷新缓存。
        }
      })
      .catch(() => {
        // 品牌设置失败不影响管理员业务会话。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const sequence = ++sequenceRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    lastRefreshRef.current = Date.now();
    const request = (async () => {
      try {
        const response = await fetch("/api/admin/me", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!mountedRef.current || sequence !== sequenceRef.current) return;

        if (response.status === 401) {
          invalidateAdminReferenceData();
          referenceScopeRef.current = null;
          meRef.current = null;
          setMe(null);
          setStatus("unauthenticated");
          setStale(false);
          setError(null);
          router.replace("/admin");
          return;
        }

        if (response.status === 403) {
          invalidateAdminReferenceData();
          referenceScopeRef.current = null;
          meRef.current = null;
          setMe(null);
          setStatus("forbidden");
          setStale(false);
          setError("当前账号无权进入管理后台");
          return;
        }

        if (!response.ok) {
          throw new Error(`管理员会话刷新失败（HTTP ${response.status}）`);
        }

        const payload = (await response.json()) as AdminMePayload;
        if (!mountedRef.current || sequence !== sequenceRef.current) return;
        const referenceScope = JSON.stringify({
          source: payload.source,
          actorId: payload.adminId ?? payload.userId ?? null,
          role: payload.role ?? payload.builtinRole ?? null,
          tenantCode: payload.tenantCode ?? null,
          deptId: payload.deptId ?? null,
          teamId: payload.teamId ?? null,
          permissions: [...(payload.permissions ?? [])].sort(),
        });
        if (referenceScopeRef.current !== referenceScope) {
          invalidateAdminReferenceData();
          referenceScopeRef.current = referenceScope;
        }
        meRef.current = payload;
        setMe(payload);
        setStatus("ready");
        setStale(false);
        setError(null);
      } catch (refreshError) {
        if (
          !mountedRef.current ||
          sequence !== sequenceRef.current ||
          controller.signal.aborted
        ) return;
        const message =
          refreshError instanceof Error ? refreshError.message : "管理员会话刷新失败";
        setStatus("error");
        setStale(meRef.current !== null);
        setError(message);
      } finally {
        if (mountedRef.current && sequence === sequenceRef.current) {
          requestAbortRef.current = null;
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = request;
    return request;
  }, [router]);

  useEffect(() => {
    void refresh();

    const onFocus = () => {
      if (Date.now() - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const value = useMemo<AdminSessionContextValue>(
    () => ({ me, siteSettings, status, stale, error, refresh }),
    [error, me, refresh, siteSettings, stale, status],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) {
    throw new Error("useAdminSession 必须在 AdminSessionProvider 内使用");
  }
  return value;
}
