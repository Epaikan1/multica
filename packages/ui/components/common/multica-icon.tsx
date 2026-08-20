// COHORT_BRANDED — wrapper genere par /home/bobo/braike-brand/apply-cohort.sh
// MulticaIcon rend en realite le wordmark COHORT.
// Pour restaurer BRAIKE : ./apply-cohort.sh --revert
// Pour restaurer l'icone Multica originale : ./apply.sh --revert
import { CohortLogo } from "./cohort-logo";
import { cn } from "../../lib/utils";

interface MulticaIconProps extends React.ComponentProps<"span"> {
  animate?: boolean;
  noSpin?: boolean;
  bordered?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizePx = { sm: 14, md: 18, lg: 22 };

export function MulticaIcon({
  className,
  bordered = false,
  size = "sm",
  animate: _animate,
  noSpin: _noSpin,
  ...props
}: MulticaIconProps) {
  if (bordered) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center border border-border rounded-md p-1.5 bg-card",
          className
        )}
        aria-hidden="true"
        {...props}
      >
        <CohortLogo size={sizePx[size]} />
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center", className)}
      aria-hidden="true"
      {...props}
    >
      <CohortLogo size={sizePx[size]} />
    </span>
  );
}
