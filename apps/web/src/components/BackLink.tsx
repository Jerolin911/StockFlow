import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" />
      {label}
    </Link>
  );
}
