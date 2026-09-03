"use client";

import { useState, FormEvent } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/components/ui/cn";

const passwordAuthEnabled = process.env.NEXT_PUBLIC_ENABLE_PASSWORD_AUTH === "true";

export interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  next?: string;
}

export function AuthForm({ mode, next = "/" }: AuthFormProps) {
  const [activeTab, setActiveTab] = useState<"sign-in" | "sign-up">(mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const isValidEmail = (email: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError("");
    setSuccessMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${next}`,
      },
    });

    if (error) setError(error.message);
    setIsLoading(false);
  };

  const handleMagicLink = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccessMessage("");

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      setIsLoading(false);
      return;
    }

    const formData = new FormData();
    formData.set("mode", activeTab);
    formData.set("email", email);
    formData.set("next", next);

    try {
      const response = await fetch(`/${activeTab}`, {
        method: "POST",
        body: formData,
      });

      if (response.redirected) {
        const url = new URL(response.url);
        const sent = url.searchParams.get("sent");
        const err = url.searchParams.get("error");

        if (err) {
          setError(err);
        } else if (sent) {
          setSuccessMessage(
            `Magic link sent to <strong>${sent}</strong>. Check your inbox.`
          );
        }
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    }

    setIsLoading(false);
  };

  const handlePasswordAuth = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccessMessage("");

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      setIsLoading(false);
      return;
    }

    if (activeTab === "sign-up" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      setIsLoading(false);
      return;
    }

    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);
    formData.set("next", next);

    try {
      const response = await fetch("/sign-in", {
        method: "POST",
        body: formData,
      });

      if (response.redirected) {
        const url = new URL(response.url);
        const err = url.searchParams.get("error");

        if (err) {
          setError(err);
        } else {
          window.location.href = next;
        }
      } else {
        setError("Invalid email or password.");
      }
    } catch {
      setError("Network error. Please try again.");
    }

    setIsLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!isValidEmail(email)) {
      setError("Please enter your email address first to reset your password.");
      return;
    }

    setIsLoading(true);
    setError("");
    setSuccessMessage("");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) setError(error.message);
    else setSuccessMessage("Password reset link sent to your email.");

    setIsLoading(false);
  };

  const clearMessages = () => {
    setError("");
    setSuccessMessage("");
  };

  const renderGoogleButton = () => (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full gap-2"
      onClick={handleGoogleSignIn}
      disabled={isLoading}
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Continue with Google
    </Button>
  );

  const renderDivider = () => (
    <div className="relative flex items-center gap-4 my-4">
      <div className="flex-1 border-t border-line-strong" />
      <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
        Or continue with email
      </span>
      <div className="flex-1 border-t border-line-strong" />
    </div>
  );

  const renderEmailForm = () => {
    const isSignUp = activeTab === "sign-up";

    return (
      <form
        onSubmit={passwordAuthEnabled ? handlePasswordAuth : handleMagicLink}
        className="flex flex-col gap-4"
      >
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@flexsoar.net"
          required
          autoComplete={isSignUp ? "email" : "email"}
          autoFocus
          error={error || undefined}
        />

        {(passwordAuthEnabled || activeTab === "sign-up") && (
          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required={passwordAuthEnabled}
              autoComplete={isSignUp ? "new-password" : "current-password"}
              error={error || undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-[38px] text-muted hover:text-foreground transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>
        )}

        {!passwordAuthEnabled && activeTab === "sign-in" && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleForgotPassword}
              className="font-mono text-[10px] uppercase tracking-tight text-muted hover:text-foreground transition-colors underline-offset-2 hover:underline"
            >
              Forgot password?
            </button>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={
            isLoading ||
            !isValidEmail(email) ||
            (passwordAuthEnabled && isSignUp && password.length < 6)
          }
        >
          {isLoading ? (
            <>
              <svg
                className="animate-spin h-5 w-5"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </>
          ) : (
            isSignUp ? "Create Account" : "Sign In"
          )}
        </Button>
      </form>
    );
  };

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold font-mono uppercase tracking-tight">
          {activeTab === "sign-up" ? "Create Account" : "Sign In"}
        </h1>
        <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
          {activeTab === "sign-up"
            ? "Start trading tokenized sneakers"
            : "Access your portfolio"}
        </p>
      </header>

      <div
        className="flex border-b border-line-strong"
        role="tablist"
        aria-label="Authentication method"
      >
        <button
          role="tab"
          aria-selected={activeTab === "sign-in"}
          onClick={() => {
            setActiveTab("sign-in");
            clearMessages();
          }}
          className={cn(
            "flex-1 pb-3 font-mono text-[11px] uppercase tracking-tight border-b-2 transition-colors",
            activeTab === "sign-in"
              ? "text-accent border-accent"
              : "text-muted hover:text-foreground border-transparent"
          )}
        >
          Sign In
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "sign-up"}
          onClick={() => {
            setActiveTab("sign-up");
            clearMessages();
          }}
          className={cn(
            "flex-1 pb-3 font-mono text-[11px] uppercase tracking-tight border-b-2 transition-colors",
            activeTab === "sign-up"
              ? "text-accent border-accent"
              : "text-muted hover:text-foreground border-transparent"
          )}
        >
          Create Account
        </button>
      </div>

      {renderGoogleButton()}
      {renderDivider()}

      {error && (
        <div
          role="alert"
          className="border p-3 pixel-shadow-sm border-[#FF4444] bg-[#FF4444]/10"
        >
          <p className="font-mono text-[11px] text-[#FF4444]">{error}</p>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="border p-3 pixel-shadow-sm border-accent bg-accent/10"
        >
          <p className="font-mono text-[11px] text-accent" dangerouslySetInnerHTML={{ __html: successMessage }} />
        </div>
      )}

      {renderEmailForm()}

      <p className="font-mono text-[10px] text-muted text-center">
        {activeTab === "sign-up" ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setActiveTab("sign-in");
                clearMessages();
              }}
              className="text-accent hover:underline underline-offset-1"
            >
              Sign In
            </button>
          </>
        ) : (
          <>
            No account yet?{" "}
            <button
              type="button"
              onClick={() => {
                setActiveTab("sign-up");
                clearMessages();
              }}
              className="text-accent hover:underline underline-offset-1"
            >
              Create one
            </button>
          </>
        )}
      </p>
    </main>
  );
}