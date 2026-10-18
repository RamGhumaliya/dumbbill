import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/layout/site-header';

/**
 * Frame for the public account pages: sign in, sign up, confirm email, forgot and reset password.
 * Only the product name and the theme switch in the header; no navigation, because nobody here is signed in yet.
 * Route groups such as "(auth)" organise code only; they do not appear in the web address.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
    </>
  );
}
