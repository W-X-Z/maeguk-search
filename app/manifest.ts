import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '매국서치 — 조상 기록 대조',
    short_name: '매국서치',
    description:
      '조상 성명을 친일반민족행위자 결정 명단(1,006명) 기록과 대조해 일치 가능한 경우의 수를 보여줍니다.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9f7',
    theme_color: '#8b2f2f',
    lang: 'ko',
  };
}
