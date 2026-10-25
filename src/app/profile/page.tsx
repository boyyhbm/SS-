import { redirect } from 'next/navigation';
import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export default async function Profile() {
  const data = await consoleData();
  if (!data.user) redirect('/login?next=/profile');
  return <Console key="profile" initialData={data} view="profile" />;
}
