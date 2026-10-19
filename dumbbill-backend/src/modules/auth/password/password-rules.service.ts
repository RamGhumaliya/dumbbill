import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../../common/errors/domain-error';
import { checkPasswordPolicy } from '../domain/password-policy';
import { BreachChecker } from './breach-checker';

/**
 * Decides whether a NEW password is acceptable: the length and predictability rules, personal details, and the
 * data-breach check. One place, used wherever a person chooses a password (sign-up, reset, change, accepting an
 * invitation), so the rule can never differ between screens.
 */
@Injectable()
export class PasswordRules {
  private readonly brand: string;

  constructor(
    config: ConfigService,
    private readonly breach: BreachChecker,
  ) {
    this.brand = config.getOrThrow<string>('BRAND_NAME');
  }

  /**
   * @throws DomainError WEAK_PASSWORD with the reasons listed in `errors[]`
   */
  async assertAcceptable(
    password: string,
    context: { email?: string; fullName?: string; businessName?: string },
  ): Promise<void> {
    const problems = checkPasswordPolicy(password, { ...context, brandName: this.brand });
    // Ask the breach service only for passwords that already passed the cheap local rules.
    if (problems.length === 0 && (await this.breach.isBreached(password))) {
      problems.push({
        field: 'password',
        message: 'This password has appeared in a data breach. Please choose a different one.',
      });
    }
    if (problems.length > 0) {
      throw new DomainError('WEAK_PASSWORD', problems[0]?.message, problems);
    }
  }
}
