'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, Settings, Shield, AlertTriangle, CalendarClock, GanttChart, Printer, Users, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAttentionCount, useTimelineBeyondCount } from '@/lib/useAttentionCount';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  badge?: number;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Portfolio',
    icon: <LayoutDashboard className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/programs',
    label: 'Programs',
    icon: <FolderKanban className="h-4 w-4" />,
  },
  {
    href: '/attention',
    label: 'Needs Attention',
    icon: <AlertTriangle className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/deadlines',
    label: 'Deadlines',
    icon: <CalendarClock className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/timeline',
    label: 'Timeline',
    icon: <GanttChart className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/workload',
    label: 'Workload',
    icon: <Users className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/pi',
    label: 'SAFe Dashboard',
    icon: <Target className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/print',
    label: 'Export Report',
    icon: <Printer className="h-4 w-4" />,
    exact: true,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <Settings className="h-4 w-4" />,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const attentionCount   = useAttentionCount();
  const timelineBeyond  = useTimelineBeyondCount();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-slate-700/50 bg-slate-900/80 flex-shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-slate-700/50 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-blue-600">
          <Shield className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-widest text-blue-400">CRN</div>
          <div className="truncate text-xs text-slate-500">PM Dashboard</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const isAttention = item.href === '/attention';
          const isTimeline  = item.href === '/timeline';
          const showBadge         = isAttention && attentionCount  !== null && attentionCount  > 0;
          const showTimelineBadge = isTimeline  && timelineBeyond  !== null && timelineBeyond  > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? isAttention
                    ? 'bg-red-600/20 text-red-400'
                    : 'bg-blue-600/20 text-blue-400'
                  : isAttention
                  ? 'text-red-500/70 hover:bg-red-950/30 hover:text-red-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              )}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white tabular-nums">
                  {attentionCount}
                </span>
              )}
              {showTimelineBadge && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-600 px-1.5 text-xs font-bold text-white tabular-nums">
                  {timelineBeyond}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-700/50 px-4 py-3">
        <div className="text-xs text-slate-600">Colvin Run Networks</div>
        <div className="text-xs text-slate-700">SBIR PM v1.0</div>
      </div>
    </aside>
  );
}
