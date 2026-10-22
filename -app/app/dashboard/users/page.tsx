'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Edit2, Shield, Trash2, UserRound } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type { User } from '@/app/types/inventory';

type PublicUser = Omit<User, 'password_hash'>;

const emptyForm = {
  name: '',
  email: '',
  password: '',
  role: 'employee' as User['role'],
};

export default function UsersPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadUsers = async () => {
    const response = await fetch('/api/users');
    if (!response.ok) {
      setError('Unable to load users.');
      return;
    }
    setUsers(await response.json());
    setError('');
  };

  useEffect(() => {
    if (!isAdmin) return;

    fetch('/api/users')
      .then((response) => {
        if (!response.ok) throw new Error('Unable to load users.');
        return response.json() as Promise<PublicUser[]>;
      })
      .then((data) => {
        setUsers(data);
        setError('');
      })
      .catch((caughtError: Error) => setError(caughtError.message));
  }, [isAdmin]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    const payload = {
      ...form,
      password: form.password || undefined,
    };
    const response = await fetch(editingId ? `/api/users/${editingId}` : '/api/users', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Unable to save user.');
      return;
    }

    setForm(emptyForm);
    setEditingId(null);
    setSuccess(editingId ? 'User updated.' : 'User created.');
    await loadUsers();
  };

  const editUser = (user: PublicUser) => {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
    });
  };

  const deleteUser = async (id: string) => {
    setError('');
    setSuccess('');
    const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Unable to delete user.');
      return;
    }
    setSuccess('User deleted.');
    await loadUsers();
  };

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-800">
          User management is available to admin users only.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">User Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage admin and employee access for the inventory system.
        </p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {success && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{success}</div>}

      <div className="grid lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="mb-4 flex items-center gap-3">
            <Shield className="text-blue-600" />
            <h2 className="text-lg font-semibold">Admin</h2>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Can manage users, products, purchases, reports, and all financial records.
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="mb-4 flex items-center gap-3">
            <UserRound className="text-green-600" />
            <h2 className="text-lg font-semibold">Employee</h2>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Can record sales and view products. Cannot delete products or view financial reports.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">{editingId ? 'Edit User' : 'Create User'}</h2>
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          <label className="text-sm font-medium">
            Name
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" required />
          </label>
          <label className="text-sm font-medium">
            Email
            <input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" required />
          </label>
          <label className="text-sm font-medium">
            Password
            <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2" required={!editingId} placeholder={editingId ? 'Leave blank to keep current password' : ''} />
          </label>
          <label className="text-sm font-medium">
            Role
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as User['role'] }))} className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2">
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex gap-3">
          <button className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">
            {editingId ? 'Update User' : 'Create User'}
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="rounded-lg border border-gray-300 px-5 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700">
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              {['Name', 'Email', 'Role', 'Created At', 'Actions'].map((heading) => (
                <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-6 py-4 font-medium">{user.name}</td>
                <td className="px-6 py-4">{user.email}</td>
                <td className="px-6 py-4">
                  <span className={`rounded-full px-3 py-1 text-sm capitalize ${user.role === 'admin' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-6 py-4">{user.created_at}</td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <button onClick={() => editUser(user)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" aria-label="Edit user">
                      <Edit2 size={18} />
                    </button>
                    <button onClick={() => void deleteUser(user.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="Delete user">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
