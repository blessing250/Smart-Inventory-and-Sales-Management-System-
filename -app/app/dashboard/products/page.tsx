'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { formatRwf } from '@/app/lib/inventory-demo-data';
import type { Product } from '@/app/types/inventory';

const emptyForm = {
  name: '',
  category: '',
  purchase_price: 0,
  selling_price: 0,
  quantity: 0,
  minimum_quantity: 5,
  supplier: '',
};

type ProductForm = typeof emptyForm;

export default function ProductsPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadProducts = async () => {
    const response = await fetch('/api/products');
    if (!response.ok) {
      setError('Unable to load products.');
      setLoading(false);
      return;
    }
    setProducts(await response.json());
    setError('');
    setLoading(false);
  };

  useEffect(() => {
    const loadInitialProducts = async () => {
      await loadProducts();
    };

    void loadInitialProducts();
  }, []);

  const filteredProducts = useMemo(
    () =>
      products.filter((product) =>
        `${product.name} ${product.category} ${product.supplier}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [products, query]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const response = await fetch(editingId ? `/api/products/${editingId}` : '/api/products', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      setError('Unable to save product. Please check the fields and try again.');
      return;
    }

    if (editingId) {
      setEditingId(null);
    }

    setForm(emptyForm);
    await loadProducts();
  };

  const deleteProduct = async (id: string) => {
    const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('Unable to delete product.');
      return;
    }
    await loadProducts();
  };

  const editProduct = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      category: product.category,
      purchase_price: product.purchase_price,
      selling_price: product.selling_price,
      quantity: product.quantity,
      minimum_quantity: product.minimum_quantity,
      supplier: product.supplier,
    });
  };

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Product Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Add, update, search, and remove unavailable products.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            ['Product Name', 'name', 'text'],
            ['Category', 'category', 'text'],
            ['Supplier', 'supplier', 'text'],
            ['Purchase Price', 'purchase_price', 'number'],
            ['Selling Price', 'selling_price', 'number'],
            ['Quantity', 'quantity', 'number'],
            ['Minimum Quantity', 'minimum_quantity', 'number'],
          ].map(([label, name, type]) => (
            <label key={name} className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {label}
              <input
                type={type}
                value={form[name as keyof ProductForm]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [name]: type === 'number' ? Number(event.target.value) : event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </label>
          ))}
        </div>
        <button className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700">
          <Plus size={18} />
          {editingId ? 'Update Product' : 'Add Product'}
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 relative">
        <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search products..."
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 pl-10 pr-4 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              {['Product', 'Category', 'Purchase', 'Selling', 'Quantity', 'Supplier', 'Date Added', 'Actions'].map((heading) => (
                <th key={heading} className="px-6 py-3 text-left text-sm font-semibold">{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-gray-600 dark:text-gray-400">
                  Loading products...
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-gray-600 dark:text-gray-400">
                  No products found.
                </td>
              </tr>
            ) : filteredProducts.map((product) => (
              <tr key={product.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-6 py-4 font-medium">{product.name}</td>
                <td className="px-6 py-4">{product.category}</td>
                <td className="px-6 py-4">{formatRwf(product.purchase_price)}</td>
                <td className="px-6 py-4">{formatRwf(product.selling_price)}</td>
                <td className="px-6 py-4">{product.quantity}</td>
                <td className="px-6 py-4">{product.supplier}</td>
                <td className="px-6 py-4">{new Date(product.created_at).toLocaleDateString()}</td>
                <td className="px-6 py-4">
                  <div className="flex gap-2">
                    <button onClick={() => editProduct(product)} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" aria-label="Edit product">
                      <Edit2 size={18} />
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => void deleteProduct(product.id)}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        aria-label="Delete product"
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
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
