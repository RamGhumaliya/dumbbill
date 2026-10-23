'use client';

import { useTranslations } from 'next-intl';
import { Badge, Checkbox } from '@/components/ui';
import type { PermissionInfo } from '@/lib/api/schemas/team';
import { groupPermissions } from './team-helpers';

/**
 * The list of abilities, grouped ("Products", "Stock", ...), with a tick box each. Used for a role and for the
 * per-person fine-tuning. The words come from the server's catalogue, so a new permission shows up here by itself.
 *
 * Abilities that reveal cost or profit are marked, because giving them to a till person defeats the point of the till.
 * `fromRole` (optional) marks the ones the chosen role already gives, so the person can see what they are changing.
 * `disabled` greys the whole list (used when the screen is saving).
 */
export function PermissionPicker({
  catalogue,
  value,
  onChange,
  fromRole,
  disabled,
  idPrefix,
}: {
  catalogue: readonly PermissionInfo[];
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  fromRole?: ReadonlySet<string>;
  disabled?: boolean;
  /** Keeps tick box ids unique when two pickers could be on the page. */
  idPrefix: string;
}) {
  const t = useTranslations('Team.picker');
  const toggle = (key: string, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(key);
    else next.delete(key);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {groupPermissions(catalogue).map(({ group, items }) => (
        <fieldset key={group} className="flex flex-col gap-3">
          <legend className="mb-1 text-caption font-medium tracking-wide text-muted uppercase">
            {group}
          </legend>
          {items.map((info) => (
            <div key={info.key} className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <Checkbox
                id={`${idPrefix}-${info.key}`}
                label={info.label}
                description={
                  info.confidential ? `${info.description} ${t('confidential')}` : info.description
                }
                checked={value.has(info.key)}
                disabled={disabled}
                onCheckedChange={(state) => toggle(info.key, state === true)}
              />
              {fromRole?.has(info.key) && <Badge variant="neutral">{t('fromRole')}</Badge>}
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
