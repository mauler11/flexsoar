/**
 * app/(auth)/sign-out/route.ts — POST /sign-out
 *
 * POST only. A GET sign-out is signed out by any link prefetch, any image tag
 * pointing at it, and any crawler.
 *
 * UI tracks have two ways in, whichever suits the component:
 *
 *   <form action="/sign-out" method="post"><button>Sign out</button></form>
 *   import { signOut } from '@/app/(auth)/actions'  ->  <form action={signOut}>
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signOut();

  const origin = new URL(request.url).origin;

  if (error) {
    return NextResponse.redirect(
      new URL(`/sign-in?error=${encodeURIComponent(error.message)}`, origin),
      // 303 so the browser follows with GET rather than re-POSTing.
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL('/', origin), { status: 303 });
}
