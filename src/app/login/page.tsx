"use client";

import React, { useActionState, useEffect } from "react";
import { loginAction } from "@/app/actions/auth";
import { Mail, KeyRound, ArrowRight, Loader2, AlertCircle, ShieldCheck, Zap, BarChart3, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);

  useEffect(() => {
    if (state?.success) {
      window.location.href = "/admin/dashboard";
    }
  }, [state]);

  return (
    <div className="flex min-h-screen bg-[#0a0a18] text-foreground">

      {/* ── LEFT PANEL: Brand showcase ─────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col overflow-hidden">

        {/* Layered background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a18] via-[#0f0f28] to-[#0a0a18]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.62_0.20_263/0.30),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(0.5_0.1_263/6%)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0.1_263/6%)_1px,transparent_1px)] bg-[size:40px_40px]" />

        {/* Glowing orbs */}
        <div className="absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full bg-indigo-600/8 blur-[90px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-violet-500/5 blur-[80px] pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full p-12 justify-between">

          {/* Logo mark */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shadow-lg shadow-primary/10">
              <Zap className="w-4.5 h-4.5 text-primary" />
            </div>
            <span className="text-base font-black tracking-tight text-white/90 uppercase">
              AV <span className="text-primary">Catalog</span>
            </span>
          </div>

          {/* Hero heading */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary uppercase tracking-widest">
                <ShieldCheck className="w-3 h-3" />
                Admin Portal
              </div>
              <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-white">
                Quản lý<br />
                <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-300 bg-clip-text text-transparent">
                  danh mục sản phẩm
                </span>
                <br />
                tập trung
              </h1>
              <p className="text-sm text-white/60 leading-relaxed max-w-sm">
                Nền tảng quản trị tập trung cho toàn bộ danh mục AV — đồng bộ, kiểm tra và xuất dữ liệu trực tiếp từ Wix CMS.
              </p>
            </div>

            {/* Feature chips */}
            <div className="grid grid-cols-1 gap-3 max-w-xs">
              {[
                { icon: Package, label: "Quản lý sản phẩm", desc: "Đồng bộ từ Wix CMS" },
                { icon: BarChart3, label: "Phân tích dữ liệu", desc: "Báo cáo & thống kê realtime" },
                { icon: ShieldCheck, label: "Bảo mật cao", desc: "Xác thực admin" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-center gap-3 p-3.5 rounded-2xl bg-white/[0.05] border border-white/[0.12] backdrop-blur-sm">
                  <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{label}</p>
                    <p className="text-[10px] text-white/55 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom attribution */}
          <p className="text-[10px] text-white/40 tracking-wide">
            © 2025 AV Catalog Management System. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── RIGHT PANEL: Login form ────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center relative p-6 sm:p-8 overflow-hidden">

        {/* Subtle mobile background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_80%_at_50%_-20%,oklch(0.62_0.20_263/0.12),transparent)] lg:hidden" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(0.5_0.1_263/5%)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0.1_263/5%)_1px,transparent_1px)] bg-[size:32px_32px]" />

        {/* Vertical divider (desktop) */}
        <div className="hidden lg:block absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.06] to-transparent" />

        {/* Form card */}
        <div className="relative z-10 w-full max-w-[380px] animate-in fade-in-0 slide-in-from-bottom-4 duration-500">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center justify-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-black tracking-tight text-white/90 uppercase">
              AV <span className="text-primary">Catalog</span>
            </span>
          </div>

          {/* Heading */}
          <div className="mb-8 space-y-1.5">
            <h2 className="text-2xl font-extrabold tracking-tight text-white">
              Đăng nhập
            </h2>
            <p className="text-sm text-white/60">
              Nhập thông tin tài khoản admin để tiếp tục.
            </p>
          </div>

          {/* Error banner */}
          {state?.error && (
            <div className="flex items-start gap-2.5 mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 animate-in fade-in-0 duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{state.error}</span>
            </div>
          )}

          {/* Form */}
          <form action={formAction} className="space-y-4">

            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">
                Địa chỉ Email
              </label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors duration-200" />
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@example.com"
                  disabled={isPending || state?.success}
                  className="w-full pl-10 pr-4 py-3 bg-white/[0.07] border border-white/[0.15] rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60 focus:bg-white/[0.10] focus:ring-0 transition-all duration-200 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-widest text-white/65">
                Mật khẩu
              </label>
              <div className="relative group">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors duration-200" />
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  disabled={isPending || state?.success}
                  className="w-full pl-10 pr-4 py-3 bg-white/[0.07] border border-white/[0.15] rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/60 focus:bg-white/[0.10] focus:ring-0 transition-all duration-200 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={isPending || state?.success}
              className="w-full h-12 mt-2 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-200 shadow-lg shadow-primary/20 active:scale-[0.98] gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending || state?.success ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang xác thực...
                </>
              ) : (
                <>
                  Đăng nhập
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </form>

          {/* Footer note */}
          <p className="mt-8 text-center text-[11px] text-white/40 tracking-wide">
            AV Catalog Manager &nbsp;·&nbsp; v1.0.0
          </p>
        </div>
      </div>
    </div>
  );
}
