import { redirect, notFound } from 'next/navigation';
import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export default async function Admin() {
  const data = await consoleData();
  if (!data.user) redirect('/login?next=/admin');
  if (data.user.role !== 'ADMIN') notFound();
  return <Console key="admin" initialData={data} view="admin" />;
}
