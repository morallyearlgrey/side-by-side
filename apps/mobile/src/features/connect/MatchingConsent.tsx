import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Notice, Toggle } from '@/components/ui';
import { useBluetooth } from '@/features/bluetooth/BluetoothProvider';
import { useMe } from '@/features/profile/useMe';
import { api, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/types';
import { useDiscovery } from './DiscoveryProvider';

export function MatchingConsent({ disabled = false }: { disabled?: boolean }) {
  const me = useMe();
  const client = useQueryClient();
  const ble = useBluetooth();
  const discovery = useDiscovery();
  const owner = me.data?.profile.user_id;
  const consent = useMutation({
    mutationFn: (granted: boolean) => api<{ granted: boolean }>('/v1/consents', {
      method: 'POST', expectedUserId: owner, body: { purpose: 'personal_matching', granted },
    }),
    onMutate: async () => {
      discovery?.hide();
      await client.cancelQueries({ queryKey: ['connections'] });
      client.removeQueries({ queryKey: ['connections'] });
      client.removeQueries({ queryKey: ['descriptions'] });
    },
    onSuccess: async ({ granted }) => {
      await client.cancelQueries({ queryKey: ['me', owner] });
      client.setQueryData<Me>(['me', owner], current => current ? {
        ...current,
        matching_consent: granted,
        profile: granted ? current.profile : { ...current.profile, discoverable: false, bluetooth_enabled: false },
      } : current);
      if (!granted) await ble.stop();
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: ['me', owner] });
      await client.invalidateQueries({ queryKey: ['connections'] });
      await client.invalidateQueries({ queryKey: ['discoveries'] });
    },
  });
  return <>
    <Toggle title="Use my approved details for matching" description="Allow personal matching with your approved details. This does not enable discovery, optional devices or shared-model training."
      value={!!me.data?.matching_consent} disabled={!me.data || me.isError || consent.isPending || disabled} onValueChange={granted => consent.mutate(granted)} />
    {consent.error && <Notice error>{errorMessage(consent.error)}</Notice>}
  </>;
}
