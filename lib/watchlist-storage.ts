'use client';

import type { StockRaw } from '@/types/stock';
import coreStocks from '@/data/stocks.sample.json';

const STORAGE_KEY = 'stock-radar:watchlist:drafts';

export type WatchlistEntry = StockRaw & {
  source: 'core' | 'draft';
  addedAt?: string; // ISO timestamp for drafts
};

function readDraftsRaw(): StockRaw[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StockRaw[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s === 'object' && typeof s.code === 'string');
  } catch {
    return [];
  }
}

function writeDraftsRaw(drafts: StockRaw[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function getCoreWatchlist(): StockRaw[] {
  return coreStocks as StockRaw[];
}

export function getDraftWatchlist(): StockRaw[] {
  return readDraftsRaw();
}

export function getFullWatchlist(): WatchlistEntry[] {
  const core = (coreStocks as StockRaw[]).map((s) => ({ ...s, source: 'core' as const }));
  const drafts = readDraftsRaw();
  const coreCodes = new Set(core.map((s) => s.code));
  const draftEntries: WatchlistEntry[] = drafts
    .filter((s) => !coreCodes.has(s.code))
    .map((s) => ({ ...s, source: 'draft' as const }));
  return [...core, ...draftEntries];
}

export function isCoreStock(code: string): boolean {
  return (coreStocks as StockRaw[]).some((s) => s.code === code);
}

export function isDraftStock(code: string): boolean {
  return readDraftsRaw().some((s) => s.code === code);
}

export function addOrUpdateDraft(stock: StockRaw): void {
  if (isCoreStock(stock.code)) return;
  const drafts = readDraftsRaw();
  const idx = drafts.findIndex((s) => s.code === stock.code);
  if (idx >= 0) drafts[idx] = stock;
  else drafts.push(stock);
  writeDraftsRaw(drafts);
}

export function removeDraft(code: string): void {
  if (isCoreStock(code)) return;
  const drafts = readDraftsRaw().filter((s) => s.code !== code);
  writeDraftsRaw(drafts);
}

export function clearDrafts(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function exportDraftsAsJsonSnippet(): string {
  const drafts = readDraftsRaw();
  return JSON.stringify(drafts, null, 2);
}
