import { toast } from 'sonner';
import { Page } from '@/components/Layout';
import { PasswordForm } from '@/components/PasswordForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function Settings() {
  const { session } = useAuth();
  return (
    <Page title="Settings">
      <div className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Signed in as {session?.user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm
              submitLabel="Change password"
              onDone={() => toast.success('Password changed')}
            />
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
