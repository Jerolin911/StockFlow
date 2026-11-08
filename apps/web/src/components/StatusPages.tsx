import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/lib/use-page-title';

function StatusPage({ code, title, message }: { code: string; title: string; message: string }) {
  usePageTitle(title);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-muted-foreground text-sm font-medium">{code}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">{message}</p>
      <Button asChild variant="outline" className="mt-6">
        <Link to="/">Go to dashboard</Link>
      </Button>
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <StatusPage
      code="403"
      title="Access denied"
      message="Your role doesn't have access to this page. Ask an administrator if you need it."
    />
  );
}

export function NotFoundPage() {
  return (
    <StatusPage code="404" title="Page not found" message="This page doesn't exist or has moved." />
  );
}
