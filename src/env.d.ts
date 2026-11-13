declare namespace App {
  interface Locals {
    /** Set by the middleware for admin requests: who signed in through Cloudflare Access */
    adminEmail?: string;
  }
}
