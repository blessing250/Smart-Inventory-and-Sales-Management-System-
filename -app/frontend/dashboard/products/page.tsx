'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Edit2, Plus, Search, Trash2 } from 'lucide-react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { formatRwf } from '@/shared/finance/currency';
import type { Product } from '@/shared/types/inventory';
import { usePreferences } from '@/frontend/lib/use-preferences';
import { ProductImport } from '@/frontend/components/product-import';
import { readBusiness } from '@/frontend/lib/business-client';

const emptyForm = {
  name: '',
  category: '',
  sku: '',
  description: '',
  family: '',
  variant_size: '',
  variant_color: '',
  variant_material: '',
  variant_design: '',
  purchase_price: 0,
  selling_price: 0,
  quantity: 0,
  minimum_quantity: 5,
  supplier: '',
};

type ProductForm = typeof emptyForm;

export default function ProductsPage() {
  const preferences = usePreferences();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin';
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<File>();
  const [saving, setSaving] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  useEffect(() => {
    readBusiness<{ kind:string; name:string }[]>('/api/contacts?view=directory').then(rows =>
      setSupplierNames(rows.filter(row => row.kind === 'Supplier').map(row => row.name))).catch(() => {});
  }, []);

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
        `${product.name} ${product.sku ?? ''} ${product.category} ${product.supplier} ${product.family ?? ''} ${product.variant_size ?? ''} ${product.variant_color ?? ''} ${product.variant_material ?? ''} ${product.variant_design ?? ''}`
          .toLowerCase()
          .includes(query.toLowerCase())
      ),
    [products, query]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(editingId ? `/api/products/${editingId}` : '/api/products', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });

      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || 'Unable to save product.');
      if (photo) {
        setEditingId(saved.id);
        const data = new FormData();
        data.set('image', photo);
        const uploaded = await fetch(`/api/products/${saved.id}/image`, { method: 'PUT', body: data });
        if (!uploaded.ok) throw new Error((await uploaded.json()).error || 'Product saved. Retry the photo upload.');
        setImageVersion(version => version + 1);
      }
      setEditingId(null);
      setPhoto(undefined);
      setForm(emptyForm);
      await loadProducts();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!window.confirm('Archive this product? Its transaction history will be kept.')) return;
    const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      setError((await response.json()).error || 'Unable to archive product.');
      return;
    }
    await loadProducts();
  };

  const editProduct = (product: Product) => {
    setEditingId(product.id);
    setPhoto(undefined);
    setForm({
      name: product.name,
      category: product.category,
      sku: product.sku ?? '',
      description: product.description ?? '',
      family: product.family ?? '',
      variant_size: product.variant_size ?? '',
      variant_color: product.variant_color ?? '',
      variant_material: product.variant_material ?? '',
      variant_design: product.variant_design ?? '',
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
        {[[
            ['Product Name', 'name', 'text'],
            ['Category', 'category', 'text'],
            ['Selling Price (RWF)', 'selling_price', 'number'],
            ['SKU (optional)', 'sku', 'text'],
          ], [
            ['Description (optional)', 'description', 'text'],
            ['Product family (optional)', 'family', 'text'],
            ['Size', 'variant_size', 'text'],
            ['Color', 'variant_color', 'text'],
            ['Material', 'variant_material', 'text'],
            ['Design', 'variant_design', 'text'],
            ['Supplier', 'supplier', 'text'],
            ['Opening Unit Cost', 'purchase_price', 'number'],
            ['Opening Quantity', 'quantity', 'number'],
            ['Minimum Quantity', 'minimum_quantity', 'number'],
          ]].map((fields, section) => {
            const controls = <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {fields.map(([label, name, type]) => (
            <label key={name} className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {label}
              <input
                type={type}
                list={name === 'family' ? 'product-families' : name === 'category' ? 'product-categories' : name === 'supplier' ? 'product-suppliers' : undefined}
                value={form[name as keyof ProductForm]}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [name]: type === 'number' ? Number(event.target.value) : event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                disabled={!!editingId && (name === 'quantity' || name === 'purchase_price')}
                required={name === 'name' || name === 'category' || name === 'selling_price'}
                min={type === 'number' ? 0 : undefined}
              />
            </label>
          ))}
            </div>;
            return section === 0 ? <div key={section}>{controls}</div> : <details key={section} className="mt-4">
              <summary className="mb-3 cursor-pointer">Optional details and opening stock</summary>{controls}
              <label className="mt-3 block">Product photo
                <input key={editingId ?? 'new'} type="file" accept="image/jpeg,image/png,image/webp" className="block"
                  onChange={event => setPhoto(event.target.files?.[0])} />
              </label>
            </details>;
          })}
        <datalist id="product-families">{[...new Set(products.map(product => product.family).filter(Boolean))].map(family =>
          <option key={family} value={family ?? ''} />)}</datalist>
        <datalist id="product-categories">{[...new Set([...(preferences?.categories ?? []), ...products.map(row => row.category)])].map(category => <option key={category} value={category} />)}</datalist>
        <datalist id="product-suppliers">{[...new Set([...supplierNames,...products.map(row => row.supplier)].filter(Boolean))].map(name => <option key={name} value={name} />)}</datalist>
        {form.sku.trim() && products.some(row => row.id !== editingId && row.sku?.toLowerCase() === form.sku.trim().toLowerCase()) &&
          <p role="status" className="mt-2 text-sm text-red-700">This SKU already belongs to another product.</p>}
        <button disabled={saving} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
          <Plus size={18} />
          {editingId ? 'Update Product' : 'Add Product'}
        </button>
      </form>
      {isAdmin && <ProductImport onImported={loadProducts} />}

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
                <td className="px-6 py-4 font-medium">
                  <div className="flex items-center gap-3">
                    {!!product.has_image && <Image unoptimized width={48} height={48} alt="" className="h-12 w-12 rounded object-cover"
                      src={`/api/products/${product.id}/image?v=${imageVersion}`} />}
                    <div>{product.name}<p className="text-xs text-gray-500">{product.sku}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-300">{[product.family, product.variant_size, product.variant_color,
                        product.variant_material, product.variant_design].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">{product.category}</td>
                <td className="px-6 py-4">{formatRwf(product.purchase_price)}</td>
                <td className="px-6 py-4">{formatRwf(product.selling_price)}</td>
                <td className="px-6 py-4">
                  <p>{product.quantity} available</p>
                  {!!product.awaiting_receipt && <p className="text-xs">{product.awaiting_receipt} awaiting receipt</p>}
                  {!!product.damaged_recorded && <p className="text-xs">{product.damaged_recorded} damaged recorded</p>}
                  {!!product.missing_recorded && <p className="text-xs">{product.missing_recorded} missing recorded</p>}
                </td>
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
