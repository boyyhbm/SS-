import { redirect } from 'next/navigation';
import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export default async function Library() {
  const data = await consoleData();
  if (!data.user) redirect('/login?next=/library');
  return <Console key="library" initialData={data} view="library" />;
}
