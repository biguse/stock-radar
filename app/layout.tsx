import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '매수 후보 레이더',
  description: '개인 투자 판단용 한국 주식 매수 후보 선별 대시보드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
