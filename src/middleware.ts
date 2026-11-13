import { defineMiddleware } from "astro:middleware";
import { checkAdminAccess } from "./lib/admin-auth";

// Every /admin page and /api/admin request must pass the Cloudflare Access check
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  if (path === "/admin" || path.startsWith("/admin/") || path.startsWith("/api/admin/")) {
    const auth = await checkAdminAccess(context.request);
    if (!auth.ok) {
      return new Response(auth.reason, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    context.locals.adminEmail = auth.email;
  }
  const response = await next();
  if (path.startsWith("/admin") || path.startsWith("/api/admin")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
});
