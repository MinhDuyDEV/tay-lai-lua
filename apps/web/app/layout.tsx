import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bài 1 — Xuất phát',
  description: 'Tập bài xuất phát sa hình hạng B bằng bàn phím.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
