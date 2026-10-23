'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { ApiError, getBrowserApiClient, teamApi } from '@/lib/api';
import { MembersPanel } from './members-panel';
import { RolesPanel } from './roles-panel';

/**
 * The team screen: People and Roles. One call (`getTeamOptions`) feeds every form (roles, branches, the permission
 * catalogue, seats); the people list is a second call. Everything here needs `team.manage`; without it the server answers
 * 403 and the screen says so instead of showing an empty page.
 */
export function TeamScreen() {
  const t = useTranslations('Team');
  const options = useQuery({
    queryKey: ['team', 'options'],
    queryFn: () => teamApi.getTeamOptions(getBrowserApiClient()),
  });
  const members = useQuery({
    queryKey: ['team', 'members'],
    queryFn: () => teamApi.listMembers(getBrowserApiClient()),
  });

  const failed = options.error ?? members.error;
  if (failed && (!options.data || !members.data)) {
    const denied = failed instanceof ApiError && failed.code === 'FORBIDDEN';
    return (
      <Alert tone="danger" title={denied ? t('errors.forbidden') : t('loadFailed')}>
        {!denied && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void options.refetch();
              void members.refetch();
            }}
          >
            {t('retry')}
          </Button>
        )}
      </Alert>
    );
  }
  if (!options.data || !members.data) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <Tabs defaultValue="people">
      <TabsList aria-label={t('tabsLabel')}>
        <TabsTrigger value="people">{t('tabs.people')}</TabsTrigger>
        <TabsTrigger value="roles">{t('tabs.roles')}</TabsTrigger>
      </TabsList>
      <TabsContent value="people" className="pt-5">
        <MembersPanel members={members.data} options={options.data} />
      </TabsContent>
      <TabsContent value="roles" className="pt-5">
        <RolesPanel options={options.data} />
      </TabsContent>
    </Tabs>
  );
}
