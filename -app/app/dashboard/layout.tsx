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
  Users,
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

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: BarChart3 },
    { name: 'Products', href: '/dashboard/products', icon: Package },
    { name: 'Stock', href: '/dashboard/stock', icon: TrendingUp },
    { name: 'Sales', href: '/dashboard/sales', icon: ShoppingCart },
    { name: 'Payments', href: '/dashboard/payments', icon: CreditCard },
  ];

  // Admin only navigation
  if (userRole === 'admin') {
    navItems.push(
      { name: 'Purchases', href: '/dashboard/purchases', icon: ShoppingBasket },
      { name: 'Reports', href: '/dashboard/reports', icon: FileBarChart },
      { name: 'Users', href: '/dashboard/users', icon: Users }
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 z-40 flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            SI
          </div>
          <span className="font-bold text-gray-900 dark:text-white">Smart Inventory</span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-gray-900 dark:bg-gray-950 text-white p-6 transform transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 z-30`}
      >
        <div className="flex items-center gap-3 mb-8 hidden lg:flex">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold">
            SI
          </div>
          <span className="text-lg font-bold leading-tight">Smart Inventory<br />Sales System</span>
        </div>

        {/* Navigation */}
        <nav className="space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <Icon size={20} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User Section */}
        <div className="absolute bottom-6 left-6 right-6">
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
      <main className="min-h-screen pt-20 lg:ml-64 lg:pt-0">
        {children}
      </main>

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
