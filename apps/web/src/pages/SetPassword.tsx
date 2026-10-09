import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PasswordForm } from '@/components/PasswordForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { SET_PASSWORD_FLAG } from '@/lib/authRedirect';

/** Landing page for invite and password-reset links. */
export default function SetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const kind = sessionStorage.getItem(SET_PASSWORD_FLAG);

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {kind === 'invite' ? 'Welcome! Set your password' : 'Set a new password'}
          </CardTitle>
          <CardDescription>
            Signed in as {session.user.email}. You’ll use this password to sign in next time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm
            submitLabel="Save password"
            onDone={() => {
              sessionStorage.removeItem(SET_PASSWORD_FLAG);
              toast.success('Password saved');
              navigate('/', { replace: true });
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
