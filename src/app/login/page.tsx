import { AuthScreen } from '@/components/auth-screen';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="login" next={next} />;
}
