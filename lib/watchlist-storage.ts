'use client';

import type { StockRaw } from '@/types/stock';
import coreStocks from '@/data/stocks.sample.json';

const DRAFTS_KEY = 'stock-radar:watchlist:drafts';
const HIDDEN_KEY = 'stock-radar:watchlist:hidden';
const ORDER_KEY = 'stock-radar:watchlist:order';

export type WatchlistEntry = StockRaw & {
  source: 'core' | 'draft';
};

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readDraftsRaw(): StockRaw[] {
  const list = readJSON<StockRaw[]>(DRAFTS_KEY, []);
  return Array.isArray(list)
    ? list.filter((s) => s && typeof s === 'object' && typeof s.code === 'string')
    : [];
}

function writeDraftsRaw(drafts: StockRaw[]): void {
  writeJSON(DRAFTS_KEY, drafts);
}

function readHidden(): Set<string> {
  const arr = readJSON<string[]>(HIDDEN_KEY, []);
  return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
}

function writeHidden(set: Set<string>): void {
  writeJSON(HIDDEN_KEY, Array.from(set));
}

function readOrder(): string[] {
  const arr = readJSON<string[]>(ORDER_KEY, []);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
}

function writeOrder(order: string[]): void {
  writeJSON(ORDER_KEY, order);
}

export function getCoreWatchlist(): StockRaw[] {
  return coreStocks as StockRaw[];
}

export function getDraftWatchlist(): StockRaw[] {
  return readDraftsRaw();
}

export function getFullWatchlist(): WatchlistEntry[] {
  const coreList = coreStocks as StockRaw[];
  const drafts = readDraftsRaw();
  const coreCodes = new Set(coreList.map((s) => s.code));

  const entries: WatchlistEntry[] = [
    ...coreList.map((s): WatchlistEntry => ({ ...s, source: 'core' })),
    ...drafts
      .filter((s) => !coreCodes.has(s.code))
      .map((s): WatchlistEntry => ({ ...s, source: 'draft' })),
  ];

  const hidden = readHidden();
  const visible = entries.filter((e) => !hidden.has(e.code));

  const order = readOrder();
  if (order.length === 0) return visible;

  const positionOf = new Map<string, number>();
  order.forEach((code, i) => positionOf.set(code, i));
  return visible.slice().sort((a, b) => {
    const pa = positionOf.has(a.code) ? positionOf.get(a.code)! : Number.POSITIVE_INFINITY;
    const pb = positionOf.has(b.code) ? positionOf.get(b.code)! : Number.POSITIVE_INFINITY;
    return pa - pb;
  });
}

export function isCoreStock(code: string): boolean {
  return (coreStocks as StockRaw[]).some((s) => s.code === code);
}

export function isDraftStock(code: string): boolean {
  return readDraftsRaw().some((s) => s.code === code);
}

export function isInWatchlist(code: string): boolean {
  return isCoreStock(code) || isDraftStock(code);
}

export function isHidden(code: string): boolean {
  return readHidden().has(code);
}

export function addOrUpdateDraft(stock: StockRaw): void {
  if (isCoreStock(stock.code)) return;
  const drafts = readDraftsRaw();
  const idx = drafts.findIndex((s) => s.code === stock.code);
  if (idx >= 0) drafts[idx] = stock;
  else drafts.push(stock);
  writeDraftsRaw(drafts);
  // Unhide if it was hidden
  const hidden = readHidden();
  if (hidden.has(stock.code)) {
    hidden.delete(stock.code);
    writeHidden(hidden);
  }
}

/**
 * Remove a stock from view.
 * - Drafts: permanently delete from localStorage
 * - Core: add to hidden set (still in repo, just hidden per device)
 */
export function removeFromWatchlist(code: string): void {
  if (isCoreStock(code)) {
    const hidden = readHidden();
    hidden.add(code);
    writeHidden(hidden);
  } else {
    const drafts = readDraftsRaw().filter((s) => s.code !== code);
    writeDraftsRaw(drafts);
  }
  // Also strip from order to keep things clean
  const order = readOrder();
  if (order.includes(code)) {
    writeOrder(order.filter((c) => c !== code));
  }
}

export function removeDraft(code: string): void {
  if (isCoreStock(code)) return;
  const drafts = readDraftsRaw().filter((s) => s.code !== code);
  writeDraftsRaw(drafts);
  const order = readOrder();
  if (order.includes(code)) {
    writeOrder(order.filter((c) => c !== code));
  }
}

export function unhideStock(code: string): void {
  const hidden = readHidden();
  if (hidden.has(code)) {
    hidden.delete(code);
    writeHidden(hidden);
  }
}

export function moveStock(code: string, direction: 'up' | 'down'): void {
  const visible = getFullWatchlist();
  const codes = visible.map((s) => s.code);
  const idx = codes.indexOf(code);
  if (idx < 0) return;
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= codes.length) return;
  const swapped = codes.slice();
  [swapped[idx], swapped[targetIdx]] = [swapped[targetIdx], swapped[idx]];
  writeOrder(swapped);
}

export function clearDrafts(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRAFTS_KEY);
  window.localStorage.removeItem(HIDDEN_KEY);
  window.localStorage.removeItem(ORDER_KEY);
}

export function exportDraftsAsJsonSnippet(): string {
  const drafts = readDraftsRaw();
  return JSON.stringify(drafts, null, 2);
}
