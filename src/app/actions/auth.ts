"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const DEFAULT_EMAIL = "trangioi479@gmail.com";
const DEFAULT_PASSWORD = "motdieunua123";

/**
 * Handles administrator login. Sets httpOnly cookie on successful validation.
 */
export async function loginAction(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const targetEmail = process.env.ADMIN_EMAIL || DEFAULT_EMAIL;
  const targetPassword = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

  if (email === targetEmail && password === targetPassword) {
    const cookieStore = await cookies();
    cookieStore.set("admin_session", "true", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      sameSite: "lax",
    });
    return { success: true };
  }

  return { success: false, error: "Email hoặc mật khẩu không chính xác." };
}

/**
 * Logs out the administrator by clearing the session cookie and redirecting to /login.
 */
export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_session");
  redirect("/login");
}
