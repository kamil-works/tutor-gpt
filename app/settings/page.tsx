import SettingsLayout from './SettingsLayout';
import { createClient } from '@/utils/supabase/server';

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className={`min-h-screen`}>
      <SettingsLayout user={user} />
    </div>
  );
}
