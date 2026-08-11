import type { MetadataRoute } from 'next';

// 전체 색인 차단 — 결과·입력 화면이 검색엔진에 남지 않도록 (설계 §10)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
