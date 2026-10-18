import type { ReactNode } from 'react';

/**
 * The frame of every public account page (sign in, sign up, reset password ...).
 *
 * Deliberately plain: one narrow column, a heavy rule above the title (the same rule the dashboard uses above its
 * figures), the title in the condensed display face, and a hairline above the footer links. No card, no shadow,
 * no illustration: the person is here for one job, and the page should get out of the way.
 *
 * The page title is the one `h1`, so screen readers announce where they are. `footer` holds the links to the
 * neighbouring pages ("Forgot your password?", "Create an account").
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:py-16">
      <div className="border-t-2 border-rule pt-4">
        <h1 className="font-display text-display font-bold tracking-wide uppercase">{title}</h1>
        {subtitle && <p className="mt-2 text-body text-muted">{subtitle}</p>}
      </div>
      {children}
      {footer && (
        <div className="flex flex-col gap-2 border-t border-line pt-4 text-small text-muted">
          {footer}
        </div>
      )}
    </div>
  );
}
