'use client';

import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CreditCard,
  FileBarChart,
  LogOut,
  Menu,
  Package,
  ShoppingBasket,
  ShoppingCart,
  TrendingUp,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { redirect } from 'next/navigation';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const userRole = (session?.user as { role?: string } | undefined)?.role;

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated' || userRole !== 'admin') {
    redirect('/login');
  }

  const navGroups = [
    { title: 'Overview', items: [
      { name: 'Dashboard', href: '/dashboard', icon: BarChart3 },
    ] },
    { title: 'Inventory and imports', items: [
      { name: 'Products', href: '/dashboard/products', icon: Package },
      { name: 'Stock', href: '/dashboard/stock', icon: TrendingUp },
      { name: 'Purchases', href: '/dashboard/purchases', icon: ShoppingBasket },
      { name: 'Shipments', href: '/dashboard/shipments', icon: ShoppingBasket },
    ] },
    { title: 'Sales and contacts', items: [
      { name: 'Sales', href: '/dashboard/sales', icon: ShoppingCart },
      { name: 'Online orders', href: '/dashboard/orders', icon: ShoppingCart },
      { name: 'Payments', href: '/dashboard/payments', icon: CreditCard },
      { name: 'Contacts', href: '/dashboard/contacts', icon: Package },
    ] },
    { title: 'Business', items: [
      { name: 'Finance', href: '/dashboard/finance', icon: CreditCard },
      { name: 'Expenses / Money Out', href: '/dashboard/finance/expenses', icon: CreditCard },
      { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart },
      { name: 'History', href: '/dashboard/history', icon: FileBarChart },
      { name: 'Settings', href: '/dashboard/settings', icon: Menu },
    ] },
  ];
  const navItems = navGroups.flatMap(group => group.items);
  const currentPage = navItems.find(item => item.href === pathname) ?? navItems.find(item =>
    item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-40 flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            BJ
          </div>
          <span className="font-bold text-gray-900 dark:text-white">BizFlow Jewelry</span>
        </div>
        <button
          type="button"
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={sidebarOpen}
          aria-controls="workspace-navigation"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        id="workspace-navigation"
        className={`fixed inset-y-0 left-0 z-30 w-64 overflow-y-auto bg-[#1d2423] px-4 pt-20 pb-5 text-white lg:block lg:pt-5 ${
          sidebarOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="flex items-center gap-3 mb-8 hidden lg:flex">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold">
            BJ
          </div>
          <span className="text-lg font-semibold leading-tight">BizFlow Jewelry</span>
        </div>

        {/* Navigation */}
        <nav aria-label="Workspace" className="space-y-4">
          {navGroups.map(group => <div key={group.title} className="space-y-1">
          <p className="px-3 text-xs font-medium text-stone-300">{group.title}</p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage?.href === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-amber-100 text-stone-950'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <Icon size={20} />
                {item.name}
              </Link>
            );
          })}</div>)}
        </nav>

        {/* User Section */}
        <div className="mt-5 border-t border-white/15 pt-4">
          <div className="p-4 bg-gray-800 rounded-lg mb-4">
            <p className="text-sm font-medium text-white mb-1">{session?.user?.name}</p>
            <p className="text-xs text-gray-400">{session?.user?.email}</p>
            <p className="text-xs text-blue-400 capitalize mt-1">{userRole || 'user'}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white transition"
          >
            <LogOut size={20} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="min-h-screen pt-16 lg:ml-64 lg:pt-0">
        <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-6 py-3 text-sm dark:border-gray-700 dark:bg-gray-800">
          <span className="font-medium">{currentPage?.name ?? 'Workspace'}</span>
          <div className="flex items-center gap-4">
            <Link className="text-blue-700 underline dark:text-blue-300" href="/dashboard/sales">New sale</Link>
            <Link className="hidden text-gray-600 hover:underline sm:block dark:text-gray-300" href="/dashboard/settings">{session?.user?.name}</Link>
          </div>
        </header>
        {children}
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
