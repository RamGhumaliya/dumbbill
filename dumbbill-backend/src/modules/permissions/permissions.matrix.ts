/**
 * THE single source of truth for what a person may do.
 *
 * Everything that talks about permissions reads from this file: the guard that protects every route, the role
 * templates a new business starts with, the team screens (they list these keys and their descriptions), the
 * Swagger documentation check, and the automatic route-by-role test. Adding a capability to the product means
 * adding ONE line here; nothing else may invent a permission name.
 *
 * Vocabulary:
 *  - a PERMISSION is one thing a person may do, named like `products.cost.read`;
 *  - a ROLE is a named bundle of permissions ("Cashier"), editable per business;
 *  - a person's ACCESS is their role's permissions, plus extras the owner granted them, minus anything the owner
 *    took away (see `computeAccess`).
 *
 * The code never asks "is this person an admin?" (`if (role === 'admin')` is forbidden): it asks "does this
 * person hold `invoice.refund`?". Roles are only a convenient way to hand out permissions.
 */

export interface PermissionInfo {
  /** Heading the team screens group it under. */
  group: string;
  /** Short name shown next to a tick box, in plain English. */
  label: string;
  /** What it lets a person do, and anything they should know before granting it. */
  description: string;
  /**
   * True for permissions that expose the business's money position (what things cost, what is earned). A role
   * meant for cashiers must never include these: the cashier-leak tests rely on this list.
   */
  confidential?: boolean;
}

export const PERMISSIONS = {
  'products.read': {
    group: 'Products',
    label: 'View products',
    description: 'See the catalogue: names, selling prices, stock levels and barcodes.',
  },
  'products.write': {
    group: 'Products',
    label: 'Add and edit products',
    description: 'Create products, change their details, GST rate, barcode and images.',
  },
  'products.cost.read': {
    group: 'Products',
    label: 'See purchase cost',
    description:
      'See what products cost to buy (weighted-average cost). Never give this to cashiers.',
    confidential: true,
  },
  'pricing.write': {
    group: 'Pricing',
    label: 'Change selling prices',
    description: 'Change MRP and selling prices, per branch if needed. Every change is recorded.',
  },
  'purchases.write': {
    group: 'Stock',
    label: 'Record purchases',
    description: 'Enter supplier purchases, which add stock and set the cost of goods.',
  },
  'stock.adjust': {
    group: 'Stock',
    label: 'Adjust stock',
    description: 'Correct stock after a count, and write off damaged or expired items.',
  },
  'stock.transfer': {
    group: 'Stock',
    label: 'Move stock between branches',
    description: 'Send stock from one branch to another.',
  },
  'pos.sell': {
    group: 'Sales',
    label: 'Sell at the till',
    description: 'Create bills at the point of sale in the branches they are assigned to.',
  },
  'discount.apply': {
    group: 'Sales',
    label: 'Give discounts',
    description: 'Apply discounts up to their discount limit. Above it, a manager must approve.',
  },
  'discount.approve': {
    group: 'Sales',
    label: 'Approve bigger discounts',
    description: "Approve discounts above a cashier's limit by entering their own PIN at the till.",
  },
  'invoice.cancel': {
    group: 'Sales',
    label: 'Cancel bills',
    description: 'Cancel a finished bill. A credit note is made; the bill itself is never deleted.',
  },
  'invoice.refund': {
    group: 'Sales',
    label: 'Refund and take returns',
    description: 'Give money back for returned items.',
  },
  'reports.sales': {
    group: 'Reports',
    label: 'See sales reports',
    description: 'Sales by day, product, branch and payment type. No cost or profit.',
  },
  'reports.profit': {
    group: 'Reports',
    label: 'See profit reports',
    description:
      'Gross profit and margin. Shows what things cost, so only trusted people should have it.',
    confidential: true,
  },
  'team.manage': {
    group: 'Business',
    label: 'Manage the team',
    description:
      'Invite people, change roles and permissions, and switch people off. They can only hand out permissions they hold themselves.',
  },
  'settings.manage': {
    group: 'Business',
    label: 'Change business settings',
    description: 'Business details, branches, GST and invoice settings, and the loyalty rules.',
  },
  'loyalty.manage': {
    group: 'Customers',
    label: 'Manage loyalty and offers',
    description: 'Run the loyalty programme, offers and coupons, and look up customers.',
  },
  'audit.read': {
    group: 'Business',
    label: 'Read the audit log',
    description: 'See who changed what, and when.',
  },
} as const satisfies Record<string, PermissionInfo>;

/** Any permission key. Using this type means a typo in a key is a compile error. */
export type PermissionKey = keyof typeof PERMISSIONS;

/** Every permission key, in the order they are listed above. */
export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Is this text a known permission key? Used to reject made-up keys sent by a client. */
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

/** The permissions that reveal cost or profit. A cashier-style role must hold none of these. */
export const CONFIDENTIAL_PERMISSIONS: readonly PermissionKey[] = ALL_PERMISSION_KEYS.filter(
  (key) => 'confidential' in PERMISSIONS[key],
);

// ---------------------------------------------------------------------------------------------
// Role templates
// ---------------------------------------------------------------------------------------------

/** The three built-in roles every business starts with. */
export type SystemRoleKey = 'OWNER' | 'ADMIN' | 'CASHIER';

export interface RolePreset {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
  /** Largest discount the role may give alone, in basis points (500 = 5%). */
  discountLimitBp: number;
  /** True when people in this role may work in every branch. */
  allBranches: boolean;
}

/**
 * The starting points. A business may edit Admin and Cashier (and add its own roles); Owner is locked.
 *
 * The numbers are sensible defaults decided with the product owner and are meant to be changed per business:
 * a cashier may give up to 5% off, an admin up to 20%. Above that, someone with `discount.approve` enters a PIN.
 */
export const ROLE_PRESETS: Record<SystemRoleKey, RolePreset> = {
  OWNER: {
    name: 'Owner',
    description: 'The person who runs the business. Always has every permission.',
    // Not used to decide anything: the owner holds EVERY permission, including ones added in future.
    permissions: [],
    discountLimitBp: 10_000,
    allBranches: true,
  },
  ADMIN: {
    name: 'Admin',
    description: 'Manages stock, prices and reports across the shop.',
    permissions: [
      'products.read',
      'products.write',
      'products.cost.read',
      'pricing.write',
      'purchases.write',
      'stock.adjust',
      'stock.transfer',
      'pos.sell',
      'discount.apply',
      'discount.approve',
      'invoice.cancel',
      'invoice.refund',
      'reports.sales',
      'reports.profit',
      'loyalty.manage',
      'audit.read',
    ],
    discountLimitBp: 2_000,
    allBranches: true,
  },
  CASHIER: {
    name: 'Cashier',
    description: 'Sells at the till. Never sees purchase cost or profit.',
    permissions: ['products.read', 'pos.sell', 'discount.apply'],
    discountLimitBp: 500,
    allBranches: false,
  },
};

// ---------------------------------------------------------------------------------------------
// A person's access
// ---------------------------------------------------------------------------------------------

/** What a person may do, worked out from their role and personal settings. Rebuilt on every request. */
export interface Access {
  /** True for the business owner: every permission, every branch, always. */
  isOwner: boolean;
  permissions: ReadonlySet<PermissionKey>;
  /** Largest discount this person may give alone, in basis points. */
  discountLimitBp: number;
  /** `ALL` or the ids of the branches this person may work in. */
  branchScope: 'ALL' | readonly string[];
}

/** The facts `computeAccess` needs. They come from the user and role rows. */
export interface AccessInput {
  isOwner: boolean;
  role: {
    systemKey: string | null;
    permissions: readonly string[];
    discountLimitBp: number;
    allBranches: boolean;
  } | null;
  extraPermissions: readonly string[];
  deniedPermissions: readonly string[];
  /** The person's own limit, or null to use the role's. */
  discountLimitBp: number | null;
  /** Ids of the branches assigned to the person. */
  branchIds: readonly string[];
}

/**
 * Work out a person's access.
 *
 *   permissions = (role's permissions + extras granted to them) - permissions taken away from them
 *
 * "Taken away" wins over everything, so the owner can say "a cashier role, but this person may not give discounts".
 * Unknown keys (left over from an old version) are ignored rather than trusted. A person with no role has no access.
 * The OWNER holds every permission whatever their role row says, so editing or deleting roles can never lock the
 * owner out, and new permissions added later reach the owner automatically.
 */
export function computeAccess(input: AccessInput): Access {
  if (input.isOwner || input.role?.systemKey === 'OWNER') {
    return {
      isOwner: true,
      permissions: new Set(ALL_PERMISSION_KEYS),
      discountLimitBp: 10_000,
      branchScope: 'ALL',
    };
  }
  const granted = new Set<PermissionKey>();
  for (const key of [...(input.role?.permissions ?? []), ...input.extraPermissions]) {
    if (isPermissionKey(key)) granted.add(key);
  }
  for (const key of input.deniedPermissions) granted.delete(key as PermissionKey);

  return {
    isOwner: false,
    permissions: granted,
    discountLimitBp: input.discountLimitBp ?? input.role?.discountLimitBp ?? 0,
    branchScope: input.role?.allBranches ? 'ALL' : [...input.branchIds],
  };
}

/**
 * Which of `wanted` permissions the actor does NOT hold, and so may not hand out.
 * The owner may hand out anything. This is the rule that stops a team manager from promoting themselves or a friend
 * to powers they do not have.
 */
export function permissionsActorCannotGrant(
  actor: Access,
  wanted: Iterable<PermissionKey>,
): PermissionKey[] {
  if (actor.isOwner) return [];
  return [...new Set(wanted)].filter((key) => !actor.permissions.has(key));
}
