export async function readBusiness<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Unable to load business records.');
  return response.json() as Promise<T>;
}

export async function postBusiness(path: string, data: object) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || 'Unable to save the transaction.');
  }
}
