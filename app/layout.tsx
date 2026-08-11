import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '조상 기록 대조 — maeguk-search',
  description:
    '입력한 조상 성명이 친일반민족행위진상규명위원회 결정 명단(1,006명)의 기록과 일치 가능한 경우의 수가 있는지 확인합니다.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
