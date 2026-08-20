/* ============================================================
   BRAIKE WORDMARK — composant React
   Source : /home/bobo/braike-brand/assets/BraikeLogo.tsx
   Installe par apply.sh dans packages/ui/components/common/braike-logo.tsx
   ============================================================ */
import { cn } from "../../lib/utils";

interface BraikeLogoProps extends React.ComponentProps<"svg"> {
  /** Taille en pixels (height). Width est calcule via aspect ratio. */
  size?: number;
  /** "default" = AI degrade, "mono" = tout dans currentColor (utile dans sidebar collapsed) */
  variant?: "default" | "mono";
}

/**
 * Wordmark BRAIKE.
 * - B, R, K, E en bleu marine (#112D4A)
 * - AI en degrade signature coral -> magenta -> violet
 *
 * Source : maquette Braike v6 (index.html lignes 230 + 266).
 * Tracage SVG des chemins originaux.
 */
export function BraikeLogo({
  size = 20,
  variant = "default",
  className,
  ...props
}: BraikeLogoProps) {
  // ID unique pour eviter les collisions si plusieurs logos sur la page
  const gradId = `bk-grad-${size}-${variant}`;
  const fill = variant === "mono" ? "currentColor" : "#112D4A";
  const aiFill = variant === "mono" ? "currentColor" : `url(#${gradId})`;

  return (
    <svg
      viewBox="0 0 880.01 212.77"
      preserveAspectRatio="xMidYMid meet"
      aria-label="BRAIKE"
      role="img"
      className={cn("inline-block", className)}
      style={{ height: `${size}px`, width: "auto", display: "inline-block", verticalAlign: "middle" }}
      {...props}
    >
      {variant === "default" && (
        <defs>
          <linearGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            x1="339"
            y1="40"
            x2="580"
            y2="175"
          >
            <stop offset="0%" stopColor="#FF7F6B" />
            <stop offset="25%" stopColor="#FF6F61" />
            <stop offset="55%" stopColor="#EC4899" />
            <stop offset="80%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
      )}
      {/* B */}
      <path
        d="M5,207.77V5h63.62c16.06,0,29.76,5.67,41.09,17,11.34,11.43,17,25.13,17,41.09,0,14.27-4.58,26.78-13.74,37.55,7.84,5.38,13.98,12.28,18.42,20.69,4.72,8.6,7.08,17.81,7.08,27.63,0,16.25-5.76,30.09-17.29,41.52-11.43,11.53-25.22,17.29-41.38,17.29H5ZM35.75,90.44h32.87c7.56,0,13.98-2.69,19.27-8.08,5.38-5.29,8.08-11.71,8.08-19.27s-2.69-13.98-8.08-19.27c-5.29-5.38-11.71-8.08-19.27-8.08h-32.87v54.7ZM35.75,177.02h44.07c7.65,0,14.22-2.74,19.7-8.22,5.38-5.48,8.08-12.09,8.08-19.84s-2.69-14.17-8.08-19.55c-5.48-5.48-12.04-8.22-19.7-8.22h-44.07v55.83Z"
        fill={fill}
        stroke={fill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
      {/* R */}
      <path
        d="M305.97,207.77h-34.72l-44.35-85.44h-34.72v85.44h-30.75V5h74.82c16.15,0,29.95,5.76,41.38,17.29,11.52,11.43,17.29,25.27,17.29,41.52,0,11.9-3.35,22.77-10.06,32.59-6.52,9.64-15.07,16.72-25.65,21.25l46.76,90.12ZM236.25,91.58c7.65,0,14.22-2.74,19.7-8.22s8.08-11.9,8.08-19.55-2.69-14.36-8.08-19.84c-5.48-5.48-12.04-8.22-19.7-8.22h-44.07v55.83h44.07Z"
        fill={fill}
        stroke={fill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
      {/* A (avec degrade AI) */}
      <path
        d="M502.91,5v202.77h-30.89v-47.33h-68.87l-29.9,47.33h-36.42L465.07,5h37.83ZM422.56,129.7h49.45V51.62l-49.45,78.08Z"
        fill={aiFill}
        stroke={aiFill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
      {/* I (avec degrade AI) */}
      <path
        d="M568.52,207.77h-30.75V5.28h30.75v202.49Z"
        fill={aiFill}
        stroke={aiFill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
      {/* K */}
      <path
        d="M744.51,5l-81.05,100.89,83.89,101.88h-39.96l-63.62-77.37-9.49,11.76v65.61h-30.75V5h30.75v88L705.11,5h39.39Z"
        fill={fill}
        stroke={fill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
      {/* E */}
      <path
        d="M875.01,5v30.75h-72.69v54.98h56.11v30.75h-56.11v55.55h72.69v30.75h-103.44V5h103.44Z"
        fill={fill}
        stroke={fill}
        strokeWidth="6"
        strokeMiterlimit="10"
      />
    </svg>
  );
}
