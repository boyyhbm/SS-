import { Console } from '@/components/console';
import { consoleData } from '@/lib/data';
export default async function ControllersPage() {
  return <Console initialData={await consoleData()} view="controllers" />;
}
