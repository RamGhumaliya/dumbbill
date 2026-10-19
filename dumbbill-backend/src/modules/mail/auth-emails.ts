import { MailMessage } from './mailer';

/**
 * The wording of every account email. Kept in one file so the tone stays consistent and a non-developer can
 * read and improve the text. Plain English, short, one clear action per email.
 *
 * Each builder returns the subject plus a text and an HTML body. All values placed into HTML are escaped,
 * so a name like `<script>` can never become markup.
 *
 * Security notes written into the emails themselves: we never ask for a password by email, we say the link
 * expires, and we tell the person what to do if they did not ask for it.
 */

/** Make text safe to put inside HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap paragraphs and one button in a very plain HTML page that works in every mail app. */
function page(
  brand: string,
  paragraphs: string[],
  button?: { label: string; url: string },
): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('');
  const action = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="background:#0f5c5c;color:#ffffff;padding:12px 20px;text-decoration:none;border-radius:4px;display:inline-block">${escapeHtml(button.label)}</a></p><p style="margin:0 0 16px;color:#555">If the button does not work, copy this link into your browser:<br>${escapeHtml(button.url)}</p>`
    : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:520px">${body}${action}<p style="margin:24px 0 0;color:#777;font-size:13px">${escapeHtml(brand)}</p></div>`;
}

interface Common {
  to: string;
  /** Product name, from BRAND_NAME. */
  brand: string;
  /** The person's name, used in the greeting. */
  name: string;
}

/** "Please confirm your email address." Sent at signup and when the person asks for a new link. */
export function verificationEmail(
  input: Common & { link: string; validHours: number },
): MailMessage {
  const { to, brand, name, link, validHours } = input;
  const lines = [
    `Hi ${name},`,
    `Please confirm your email address to finish setting up ${brand}. The link works for ${validHours} hours.`,
  ];
  const ignore = `If you did not create a ${brand} account, you can ignore this email.`;
  return {
    to,
    subject: `Confirm your email for ${brand}`,
    text: `${lines.join('\n\n')}\n\n${link}\n\n${ignore}\n`,
    html: page(brand, [...lines.map(escapeHtml), escapeHtml(ignore)], {
      label: 'Confirm email',
      url: link,
    }),
  };
}

/**
 * Sent instead of a verification email when someone signs up with an address that already has an account.
 * The signup page answers the same way in both cases (so strangers cannot find out who has an account); this
 * email is how the real owner of the address learns about it.
 */
export function alreadyRegisteredEmail(
  input: Common & { loginLink: string; resetLink: string },
): MailMessage {
  const { to, brand, name, loginLink, resetLink } = input;
  const lines = [
    `Hi ${name},`,
    `Someone tried to create a ${brand} account with this email address, but you already have one.`,
    `If it was you, just sign in. If you have forgotten your password you can reset it: ${resetLink}`,
    `If it was not you, you do not need to do anything. Your account has not been changed.`,
  ];
  return {
    to,
    subject: `You already have a ${brand} account`,
    text: `${lines.join('\n\n')}\n\nSign in: ${loginLink}\n`,
    html: page(brand, lines.map(escapeHtml), { label: 'Sign in', url: loginLink }),
  };
}

/** The password-reset link. It works once and for a short time. */
export function passwordResetEmail(
  input: Common & { link: string; validMinutes: number },
): MailMessage {
  const { to, brand, name, link, validMinutes } = input;
  const lines = [
    `Hi ${name},`,
    `We received a request to reset your ${brand} password. Use the link below to choose a new one. It works once and expires in ${validMinutes} minutes.`,
  ];
  const ignore =
    'If you did not ask for this, ignore this email: your password stays as it is. We will never ask for your password by email.';
  return {
    to,
    subject: `Reset your ${brand} password`,
    text: `${lines.join('\n\n')}\n\n${link}\n\n${ignore}\n`,
    html: page(brand, [...lines.map(escapeHtml), escapeHtml(ignore)], {
      label: 'Choose a new password',
      url: link,
    }),
  };
}

/** Tells the person their password changed, so a change they did not make is noticed at once. */
export function passwordChangedEmail(input: Common): MailMessage {
  const { to, brand, name } = input;
  const lines = [
    `Hi ${name},`,
    `The password of your ${brand} account was just changed, and you were signed out on your other devices.`,
    `If this was you, there is nothing more to do. If it was not you, reset your password straight away and contact support.`,
  ];
  return {
    to,
    subject: `Your ${brand} password was changed`,
    text: `${lines.join('\n\n')}\n`,
    html: page(brand, lines.map(escapeHtml)),
  };
}

/**
 * "You have been invited to <business>". Sent when an owner or manager adds a person to the team.
 * The link lets the invited person choose their own password; nobody else ever sees or sets it.
 */
export function invitationEmail(
  input: Common & {
    inviterName: string;
    businessName: string;
    roleName: string;
    link: string;
    validDays: number;
  },
): MailMessage {
  const { to, brand, name, inviterName, businessName, roleName, link, validDays } = input;
  const lines = [
    `Hi ${name},`,
    `${inviterName} has invited you to join ${businessName} on ${brand}, as ${roleName}.`,
    `Choose a password to start. The link works once and for ${validDays} days.`,
  ];
  const ignore = `If you were not expecting this, ignore this email: nothing happens until you open the link.`;
  return {
    to,
    subject: `${inviterName} invited you to ${businessName} on ${brand}`,
    text: `${lines.join('\n\n')}\n\n${link}\n\n${ignore}\n`,
    html: page(brand, [...lines.map(escapeHtml), escapeHtml(ignore)], {
      label: 'Accept the invitation',
      url: link,
    }),
  };
}
