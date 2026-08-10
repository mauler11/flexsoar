/**
 * lib/db/vendor-shims.d.ts
 *
 * TEMPORARY. DELETE THIS FILE once the packages in DEPS.md are installed.
 *
 * `@supabase/ssr`, `@supabase/supabase-js` and `stripe` are not in
 * package.json, and AGENT_RULES.md forbids a track agent from putting them
 * there — a human installs them from DEPS.md. Until that happens every import
 * of them is an unresolved module and `tsc --noEmit` fails on the whole tree,
 * which would hide any real type error in the code this track wrote.
 *
 * These declarations narrow the published APIs to the surface this repo
 * actually uses. They are deliberately no looser than the real types, so code
 * that compiles against them compiles against the real packages too.
 *
 * WHY IT MUST BE DELETED: TypeScript resolves ambient module declarations
 * BEFORE it resolves node_modules. Leaving this file in place after
 * `npm i @supabase/ssr @supabase/supabase-js stripe` means the real type
 * definitions are never consulted, and a future breaking change in any of the
 * three ships silently. Deleting it is step two of the install.
 */

declare module '@supabase/supabase-js' {
  export interface PostgrestError {
    message: string;
    details: string | null;
    hint: string | null;
    code: string;
  }

  export interface PostgrestResponse<T> {
    data: T | null;
    error: PostgrestError | null;
    status: number;
    statusText: string;
    count: number | null;
  }

  export interface PostgrestFilterBuilder<T>
    extends PromiseLike<PostgrestResponse<T>> {
    /** Lives on the transform builder in the real package, hence after insert/update too. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select<U = any>(
      columns?: string,
      options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' },
    ): PostgrestFilterBuilder<U[]>;
    eq(column: string, value: unknown): this;
    neq(column: string, value: unknown): this;
    gt(column: string, value: unknown): this;
    gte(column: string, value: unknown): this;
    lt(column: string, value: unknown): this;
    lte(column: string, value: unknown): this;
    is(column: string, value: boolean | null): this;
    like(column: string, pattern: string): this;
    ilike(column: string, pattern: string): this;
    in(column: string, values: readonly unknown[]): this;
    or(filters: string, options?: { referencedTable?: string }): this;
    order(
      column: string,
      options?: {
        ascending?: boolean;
        nullsFirst?: boolean;
        referencedTable?: string;
      },
    ): this;
    limit(count: number, options?: { referencedTable?: string }): this;
    range(from: number, to: number, options?: { referencedTable?: string }): this;
    single(): PromiseLike<PostgrestResponse<T extends readonly (infer U)[] ? U : T>>;
    maybeSingle(): PromiseLike<
      PostgrestResponse<T extends readonly (infer U)[] ? U : T>
    >;
  }

  export interface PostgrestQueryBuilder {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select<T = any>(
      columns?: string,
      options?: { head?: boolean; count?: 'exact' | 'planned' | 'estimated' },
    ): PostgrestFilterBuilder<T[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert<T = any>(values: unknown, options?: Record<string, unknown>): PostgrestFilterBuilder<T[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update<T = any>(values: unknown, options?: Record<string, unknown>): PostgrestFilterBuilder<T[]>;
  }

  export interface AuthError {
    message: string;
    status?: number;
    code?: string;
    name: string;
  }

  export interface AuthUser {
    id: string;
    email?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user_metadata: Record<string, any>;
  }

  export interface AuthSession {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    user: AuthUser;
  }

  export interface SupabaseAuthClient {
    getUser(jwt?: string): Promise<{
      data: { user: AuthUser | null };
      error: AuthError | null;
    }>;
    getSession(): Promise<{
      data: { session: AuthSession | null };
      error: AuthError | null;
    }>;
    getClaims(): Promise<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { claims: Record<string, any> } | null;
      error: AuthError | null;
    }>;
    signInWithOtp(credentials: {
      email: string;
      options?: {
        emailRedirectTo?: string;
        shouldCreateUser?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data?: Record<string, any>;
      };
    }): Promise<{
      data: { user: AuthUser | null; session: AuthSession | null };
      error: AuthError | null;
    }>;
    verifyOtp(params: {
      token_hash: string;
      type: 'email' | 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change';
    }): Promise<{
      data: { user: AuthUser | null; session: AuthSession | null };
      error: AuthError | null;
    }>;
    exchangeCodeForSession(authCode: string): Promise<{
      data: { user: AuthUser | null; session: AuthSession | null };
      error: AuthError | null;
    }>;
    signOut(options?: { scope?: 'global' | 'local' | 'others' }): Promise<{
      error: AuthError | null;
    }>;
  }

  export interface SupabaseClient {
    from(relation: string): PostgrestQueryBuilder;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc<T = any>(
      fn: string,
      args?: Record<string, unknown>,
      options?: { head?: boolean; get?: boolean; count?: 'exact' | 'planned' | 'estimated' },
    ): PostgrestFilterBuilder<T>;
    auth: SupabaseAuthClient;
  }
}

declare module '@supabase/ssr' {
  import type { SupabaseClient } from '@supabase/supabase-js';

  export interface CookieOptions {
    domain?: string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: boolean | 'lax' | 'strict' | 'none';
    secure?: boolean;
    [key: string]: unknown;
  }

  export interface CookieToGet {
    name: string;
    value: string;
  }

  export interface CookieToSet {
    name: string;
    value: string;
    options?: CookieOptions;
  }

  export interface CookieMethodsServer {
    getAll(): CookieToGet[] | Promise<CookieToGet[]>;
    setAll?(cookiesToSet: CookieToSet[]): void | Promise<void>;
  }

  export interface SupabaseClientOptions {
    cookieOptions?: CookieOptions;
    cookieEncoding?: 'raw' | 'base64url';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    auth?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db?: Record<string, any>;
  }

  export function createServerClient(
    supabaseUrl: string,
    supabaseKey: string,
    options: SupabaseClientOptions & { cookies: CookieMethodsServer },
  ): SupabaseClient;

  export function createBrowserClient(
    supabaseUrl: string,
    supabaseKey: string,
    options?: SupabaseClientOptions,
  ): SupabaseClient;
}

declare module 'stripe' {
  // A class and a namespace of the same name merge only when the class comes
  // first. Keep this order.
  class Stripe {
    constructor(apiKey: string, config?: Stripe.StripeConfig);

    readonly webhooks: {
      constructEventAsync(
        payload: string | Buffer,
        header: string | string[],
        secret: string,
        tolerance?: number,
      ): Promise<Stripe.Event>;
      constructEvent(
        payload: string | Buffer,
        header: string | string[],
        secret: string,
        tolerance?: number,
      ): Stripe.Event;
    };
  }

  namespace Stripe {
    interface Metadata {
      [name: string]: string;
    }

    interface PaymentIntent {
      id: string;
      object: 'payment_intent';
      amount: number;
      amount_received: number;
      currency: string;
      status: string;
      metadata: Metadata;
    }

    interface Event {
      id: string;
      object: 'event';
      type: string;
      created: number;
      livemode: boolean;
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        object: Record<string, any>;
      };
    }

    interface StripeConfig {
      apiVersion?: string;
      typescript?: boolean;
      maxNetworkRetries?: number;
      telemetry?: boolean;
    }
  }

  export = Stripe;
}
