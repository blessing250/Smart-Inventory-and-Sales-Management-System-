'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, Package, TrendingUp, BarChart3, Lock } from 'lucide-react';

export default function Home() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
      {/* Navigation */}
      <nav className="flex items-center justify-between p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">
            <Package size={24} />
          </div>
          <span className="text-xl font-bold text-gray-900 dark:text-white">Smart Inventory</span>
        </div>
        <div className="flex items-center gap-4">
          {session ? (
            <>
              <span className="text-gray-700 dark:text-gray-300">{session.user?.name}</span>
              <Link
                href="/dashboard"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Dashboard
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Sign In
            </Link>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] max-w-6xl mx-auto px-4">
        <div className="text-center space-y-6">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
            Smart Inventory & Sales<br/>Management System
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Manage your inventory, track sales, monitor stock levels, and maximize profits with our comprehensive management system.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-8">
            {session ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                Go to Dashboard
                <ArrowRight size={20} />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                >
                  Get Started
                  <ArrowRight size={20} />
                </Link>
                <Link
                  href="#features"
                  className="inline-flex items-center gap-2 px-8 py-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition font-medium border border-gray-200 dark:border-gray-600"
                >
                  Learn More
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Features Section */}
        <section id="features" className="mt-24 w-full">
          <h2 className="text-3xl font-bold text-center text-gray-900 dark:text-white mb-12">
            Key Features
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mb-4">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Product Management</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">Add, edit, and manage your products efficiently</p>
            </div>

            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
              <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Stock Management</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">Track inventory levels and stock movements</p>
            </div>

            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
              <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center mb-4">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Sales Tracking</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">Record sales and monitor revenue in real-time</p>
            </div>

            <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-lg flex items-center justify-center mb-4">
                <Lock className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Secure Access</h3>
              <p className="text-gray-600 dark:text-gray-400 text-sm">Role-based access control for security</p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-24 py-8 border-t border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 text-center text-gray-600 dark:text-gray-400">
          <p>&copy; 2026 Smart Inventory and Sales Management System. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
