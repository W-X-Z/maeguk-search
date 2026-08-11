import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.');
}

// 읽기 전용(anon + RLS select). 서비스 롤 키는 앱 코드에서 사용하지 않는다.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
});
