import { redirect } from 'next/navigation';
import { consoleData } from '@/lib/data';
import { Console } from '@/components/console';
export default async function FriendsPage() {
  const data = await consoleData();
  if (!data.user) redirect('/login?next=/friends');
  return <Console initialData={data} view="friends" />;
}
