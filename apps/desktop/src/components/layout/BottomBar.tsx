import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface BottomBarStat {
  label: string;
  value: React.ReactNode;
  /** Resalta la cifra en naranja (como "58.5 GB" en la referencia 01). */
  highlight?: boolean;
}

export function BottomBar({ stats, children }: { stats: BottomBarStat[]; children?: React.ReactNode }) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-4 rounded-lg border bg-panel px-5">
      <div className="flex min-w-0 flex-1 items-center gap-4 text-[12px] text-muted-foreground">
        {stats.map((stat, i) => (
          <Fragment key={stat.label}>
            {i > 0 && <span className="h-4 w-px bg-border" />}
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              {stat.label}
              <span
                className={cn(
                  "text-[15px] font-semibold",
                  stat.highlight ? "font-mono text-brand" : "text-foreground",
                )}
              >
                {stat.value}
              </span>
            </span>
          </Fragment>
        ))}
      </div>
      {children && <div className="flex items-center gap-3">{children}</div>}
    </div>
  );
}
