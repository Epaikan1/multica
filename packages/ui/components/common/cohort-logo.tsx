/* ============================================================
   COHORT WORDMARK — composant React
   Source : /home/bobo/braike-brand/assets/cohort/CohortLogo.tsx
   Installe par apply.sh dans packages/ui/components/common/cohort-logo.tsx

   Design :
   - C, R, T en bleu marine Braike (#112D4A)
   - OHO (3 lettres centrales) en degrade signature coral -> magenta -> violet
   - Texte SVG natif avec Raleway 900 (importe via braike-tokens.css)

   Inspire du logo BRAIKE : sobre encadre + degrade au milieu.
   "COHORT" est plus long que "BRAIKE" mais le pattern visuel reste :
   3 lettres encadrent 3 lettres degradees.
   ============================================================ */
import { cn } from "../../lib/utils";

interface CohortLogoProps extends React.ComponentProps<"svg"> {
  /** Taille en pixels (height). Width est calcule via aspect ratio. */
  size?: number;
  /** "default" = OHO degrade, "mono" = tout dans currentColor */
  variant?: "default" | "mono";
}

/**
 * Wordmark COHORT.
 * - C, R, T en bleu marine (#112D4A)
 * - OHO (3 lettres centrales) en degrade signature
 *
 * Utilise <text> SVG avec Raleway 900 (deja charge par braike-tokens.css).
 * Le viewBox est calibre pour donner le bon aspect ratio (~4.6:1).
 */
export function CohortLogo({
  size = 20,
  variant = "default",
  className,
  ...props
}: CohortLogoProps) {
  const gradId = `cohort-grad-${size}-${variant}`;
  const fill = variant === "mono" ? "currentColor" : "#112D4A";
  const ohoFill = variant === "mono" ? "currentColor" : `url(#${gradId})`;

  return (
    <svg
      viewBox="0 0 460 100"
      preserveAspectRatio="xMidYMid meet"
      aria-label="COHORT"
      role="img"
      className={cn("inline-block", className)}
      style={{
        height: `${size}px`,
        width: "auto",
        display: "inline-block",
        verticalAlign: "middle",
      }}
      {...props}
    >
      {variant === "default" && (
        <defs>
          <linearGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            x1="120"
            y1="20"
            x2="340"
            y2="80"
          >
            <stop offset="0%" stopColor="#FF7F6B" />
            <stop offset="25%" stopColor="#FF6F61" />
            <stop offset="55%" stopColor="#EC4899" />
            <stop offset="80%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        </defs>
      )}

      {/* Le <text> SVG utilise la font Raleway 900 chargee par les tokens Braike.
          On positionne lettre par lettre pour coloriser CO[HOR]T differement :
          - C   en bleu marine
          - OHO en degrade (les 3 lettres centrales)
          - RT  en bleu marine */}

      {/* C — lettre 1 */}
      <text
        x="0"
        y="78"
        fontFamily="'Raleway', sans-serif"
        fontWeight="900"
        fontSize="96"
        letterSpacing="2"
        fill={fill}
        stroke={fill}
        strokeWidth="2"
        strokeLinejoin="round"
      >
        C
      </text>

      {/* OHO — lettres 2-3-4 en degrade */}
      <text
        x="65"
        y="78"
        fontFamily="'Raleway', sans-serif"
        fontWeight="900"
        fontSize="96"
        letterSpacing="2"
        fill={ohoFill}
        stroke={ohoFill}
        strokeWidth="2"
        strokeLinejoin="round"
      >
        OHO
      </text>

      {/* RT — lettres 5-6 */}
      <text
        x="295"
        y="78"
        fontFamily="'Raleway', sans-serif"
        fontWeight="900"
        fontSize="96"
        letterSpacing="2"
        fill={fill}
        stroke={fill}
        strokeWidth="2"
        strokeLinejoin="round"
      >
        RT
      </text>
    </svg>
  );
}
