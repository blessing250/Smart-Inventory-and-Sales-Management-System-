'use client';

import { signIn } from 'next-auth/react';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, AlertCircle, Package } from 'lucide-react';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    const email = String(fields.get('email') ?? '').trim();
    const password = String(fields.get('password') ?? '');
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.ok) {
        router.push('/dashboard');
      } else if (result?.status === 429 || result?.error === 'RateLimited') {
        setError('Too many sign-in attempts. Wait a minute and try again.');
      } else if (result?.error === 'SchemaUpgradeRequired') {
        setError('The business database needs a reviewed schema upgrade. See the setup guide.');
      } else if (result?.error === 'CredentialsSignin') {
        setError('Invalid email or password.');
      } else {
        setError('Sign-in is temporarily unavailable. Try again shortly.');
      }
    } catch {
      setError('Could not connect to BizFlow. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
              <Package size={24} />
            </div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">BizFlow Jewelry</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
            Sign In
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
            Inventory & Sales Management System
          </p>

          {/* Error Message */}
          {error && (
            <div role="alert" className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form method="post" onSubmit={handleSubmit} className="space-y-4">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none transition"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white outline-none transition"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-2">
                <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}
                  className="text-sm font-medium text-gray-700 underline dark:text-gray-300">
                  {showPassword ? 'Hide password' : 'Show password'}
                </button>
                <Link href="/forgot-password" className="text-sm font-medium text-emerald-800 underline dark:text-emerald-300">
                  Forgot password?
                </Link>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition duration-200 mt-6"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <p className="text-gray-600 dark:text-gray-400">
              Don&apos;t have an account?{' '}
              <Link href="/" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                Go back home
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
