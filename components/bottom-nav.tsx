'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

const ITEMS: NavItem[] = [
  { href: '/', label: '워치', icon: '🏠' },
  { href: '/thermometer', label: '온도', icon: '🌡️' },
  { href: '/genius', label: '거장', icon: '🎯' },
  { href: '/screener', label: '스크리너', icon: '💡' },
  { href: '/trending', label: '오늘', icon: '🔥' },
  { href: '/add', label: '추가', icon: '➕' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
      <ul className="mx-auto flex max-w-2xl items-stretch">
        {ITEMS.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] transition ${
                  active ? 'text-sky-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="text-base leading-none" aria-hidden>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
