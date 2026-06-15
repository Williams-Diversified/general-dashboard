import type { ReactNode } from 'react';
import Sidebar from './Sidebar';

interface LayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function Layout({ title, subtitle, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-4">
          <div>
            <h1 className="text-2xl font-semibold text-navy-800">{title}</h1>
            {subtitle && (
              <p className="text-sm text-slate-500">{subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="search"
              placeholder="Search…"
              className="hidden w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600 sm:block"
            />
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-600 text-sm font-semibold text-white">
              ND
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}
