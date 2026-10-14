'use client';

import { useUiMode } from '@/components/app/UiModeProvider';
import { useSession } from '@/components/site/SessionProvider';
import { cn, Skeleton } from '@/components/ui';

/**
 * Ghost of the owner's add block (AddPanel) for the loading skeleton of `/<id>`. Only a signed-in visitor on the
 * website gets one – they are almost always looking at their own library, which has the block – so the page does
 * not jump by the height of the block when the real catalogue arrives. Everybody else's page has no such block.
 * The session comes from the layout's context, so the server-rendered skeleton already knows it (no flash).
 */
export function AddPanelGhost({ className }: { className?: string }) {
  const { user } = useSession();
  const { mode } = useUiMode();
  if (!user || mode === 'app') return null;
  return (
    <div
      aria-hidden="true"
      className={cn('relative rounded-card border border-accent/30 bg-accent-soft/40 p-3 shadow-soft sm:p-4', className)}
    >
      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-stretch">
        <div className="flex flex-col justify-center gap-2.5 px-1 lg:pr-2 lg:pl-3">
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[10.25rem] rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
