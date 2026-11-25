export type HistoryRow = { id: string; name: string; reference: string; status: string; recorded_at: string | null; amount: number | null; detail: string };
export type HistoryPage = { rows: HistoryRow[]; total: number; page: number; size: number; pages: number };
