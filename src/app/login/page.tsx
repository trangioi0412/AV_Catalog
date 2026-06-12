"use client";

import React, { useActionState, useEffect } from "react";
import { loginAction } from "@/app/actions/auth";
import { Mail, KeyRound, ArrowRight, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  // Trigger page transition on success
  useEffect(() => {
    if (state?.success) {
      window.location.href = "/admin/dashboard";
    }
  }, [state]);

  return (
    <div className="relative flex items-center justify-center min-h-screen bg-[#07070f] text-foreground overflow-hidden">
      
      {/* Background Decorative Glow */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px] pointer-events-none -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 animate-pulse" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f0f1c_1px,transparent_1px),linear-gradient(to_bottom,#0f0f1c_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-35 pointer-events-none" />

      {/* Login Card */}
      <div className="relative w-full max-w-md p-8 bg-card/60 border border-primary/15 rounded-3xl backdrop-blur-2xl shadow-[0_0_50px_rgba(99,102,241,0.1)] space-y-8 z-10 animate-in fade-in-0 zoom-in-95 duration-300">
        
        {/* Logo / Title */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="p-3 bg-primary/10 rounded-2xl border border-primary/20 shadow-inner">
            <Sparkles className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
              AV Catalog Portal
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Đăng nhập bằng tài khoản Admin để quản lý
            </p>
          </div>
        </div>

        {/* Login Form */}
        <form action={formAction} className="space-y-5">
          {/* Error Message banner */}
          {state?.error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/25 text-xs text-destructive animate-in fade-in-0 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{state.error}</span>
            </div>
          )}

          {/* Email input field */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground pl-1">
              Địa chỉ Email
            </label>
            <div className="relative group/field">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within/field:text-primary transition-colors duration-200" />
              <input
                name="email"
                type="email"
                required
                placeholder="admin@example.com"
                disabled={isPending || state?.success}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0a0a14]/60 border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 placeholder:text-muted-foreground disabled:opacity-50"
              />
            </div>
          </div>

          {/* Password input field */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center px-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Mật khẩu
              </label>
            </div>
            <div className="relative group/field">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within/field:text-primary transition-colors duration-200" />
              <input
                name="password"
                type="password"
                required
                placeholder="••••••••"
                disabled={isPending || state?.success}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0a0a14]/60 border border-border/80 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200 placeholder:text-muted-foreground disabled:opacity-50"
              />
            </div>
          </div>

          {/* Submit button */}
          <Button
            type="submit"
            disabled={isPending || state?.success}
            className="w-full h-11 text-sm font-semibold rounded-xl bg-primary hover:bg-primary/95 text-primary-foreground transition-all duration-200 shadow-md shadow-primary/10 active:scale-[0.99] gap-1.5 mt-2 disabled:opacity-50 cursor-pointer"
          >
            {isPending || state?.success ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Đang đăng nhập...
              </>
            ) : (
              <>
                Tiếp Tục
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </form>

        {/* Footer info */}
        <div className="text-center pt-2">
          <span className="text-[10px] text-muted-foreground tracking-wide">
            Hệ thống quản lý AV Catalog Manager v1.0.0
          </span>
        </div>

      </div>
    </div>
  );
}
