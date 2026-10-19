import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainError } from '../../common/errors/domain-error';
import { Access } from './permissions.matrix';

/**
 * Branch scope: which of a business's shops a person may work in.
 *
 * Two layers protect data (security.md section 3). Row-level security separates BUSINESSES in the database. Which
 * BRANCHES of one business a person may use is decided here, in the application, because it depends on the person's
 * role and assignments and changes often.
 *
 *   - `BranchScope` answers questions about a person's branches (used by services to filter lists);
 *   - `@BranchScoped({ param: 'branchId' })` + `BranchScopeGuard` refuse a request that names a branch the person
 *     may not use, before any code runs.
 *
 * Rule of thumb for later modules: a list endpoint filters with `scope.filter()`, a "one item" endpoint checks the
 * item's branch with `scope.assert(branchId)`.
 */
export class BranchScope {
  constructor(private readonly access: Pick<Access, 'branchScope'>) {}

  /** True when the person may work in every branch. */
  get isAll(): boolean {
    return this.access.branchScope === 'ALL';
  }

  /** May the person use this branch? */
  allows(branchId: string): boolean {
    return this.access.branchScope === 'ALL' || this.access.branchScope.includes(branchId);
  }

  /**
   * @throws DomainError FORBIDDEN when the person may not use this branch.
   */
  assert(branchId: string): void {
    if (!this.allows(branchId)) {
      throw new DomainError('FORBIDDEN', 'You do not have access to this branch.');
    }
  }

  /**
   * The branch ids to filter a list by, or `undefined` for "no filter" (every branch). Use as
   * `where: { branchId: scope.filter() }` with Prisma, where undefined means "do not filter".
   */
  filter(): { in: string[] } | undefined {
    return this.access.branchScope === 'ALL' ? undefined : { in: [...this.access.branchScope] };
  }
}

export const BRANCH_SCOPED = 'dumbbill:branchScoped';

/** Where a route carries the branch id the request is about. */
export interface BranchScopedOptions {
  /** Name of the path parameter, query value or body field holding the branch id. */
  param: string;
}

/** Mark a route as being about one branch, so `BranchScopeGuard` checks the person may use it. */
export const BranchScoped = (options: BranchScopedOptions): MethodDecorator =>
  SetMetadata(BRANCH_SCOPED, options);

/** Refuses requests that name a branch outside the signed-in person's scope. Registered globally. */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<BranchScopedOptions | undefined>(
      BRANCH_SCOPED,
      context.getHandler(),
    );
    if (!options) return true;
    const request = context.switchToHttp().getRequest<Request>();
    // The permissions guard has already run for protected routes and loaded the access.
    if (!request.access) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue.');

    const body = request.body as Record<string, unknown> | undefined;
    const value =
      request.params[options.param] ?? request.query[options.param] ?? body?.[options.param];
    if (typeof value === 'string' && value.length > 0)
      new BranchScope(request.access).assert(value);
    return true;
  }
}
