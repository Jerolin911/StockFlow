import { NavLink } from 'react-router';
import { useCurrentUser } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { visibleSections } from '../navigation';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { permissions } = useCurrentUser();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6 px-3 py-4">
      {visibleSections(permissions).map((section, index) => (
        <div key={section.label ?? index} className="grid gap-1">
          {section.label ? (
            <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">{section.label}</p>
          ) : null}
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end ?? false}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium outline-none focus-visible:ring-2',
                  isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
