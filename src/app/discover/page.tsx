import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export const dynamic = 'force-dynamic';
export default async function Discover() {
  return <Console key="discover" initialData={await consoleData()} view="discover" />;
}
