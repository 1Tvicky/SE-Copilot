import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="text-lg font-semibold">
            SE Copilot
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
