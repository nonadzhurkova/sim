import Link from "next/link";

export function NavBar() {
  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold text-gray-900">
          F1 Predictor
        </Link>
        <nav className="flex gap-4 text-sm text-gray-600">
          <Link href="/" className="hover:text-gray-900">
            Home
          </Link>
        </nav>
      </div>
    </header>
  );
}
