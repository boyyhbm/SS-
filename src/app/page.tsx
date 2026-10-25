import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export const dynamic = 'force-dynamic';
export default async function Home() {
  return <Console initialData={await consoleData()} view="home" />;
}
