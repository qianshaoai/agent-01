import { AdminSessionProvider } from "@/components/admin/admin-session-provider";
import { AdminShell } from "@/components/layout/admin-shell";

export default function AdminConsoleLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
}
