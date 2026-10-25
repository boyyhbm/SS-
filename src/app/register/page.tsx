import { AuthScreen } from '@/components/auth-screen';
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="register" next={next} />;
}
