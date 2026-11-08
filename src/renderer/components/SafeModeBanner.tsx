import { TriangleAlert } from "lucide-react";
import { t } from "../i18n";
import { formatNumber } from "../format";
import type { SafeModeInfo } from "../../utils/types";

/**
 * Says what safe mode turned off, and how to leave it.
 *
 * The banner is the app's own answer to "why is nothing answering": it names the
 * three things that are off instead of leaving the user to work it out.
 */
export const SafeModeBanner: React.FC<{ safeMode: SafeModeInfo }> = ({ safeMode }) => (
  <div role="status" className="shrink-0 border-b border-line bg-card-2 px-5 py-2.5 flex items-start gap-3">
    <TriangleAlert size={14} className="text-accent-ink shrink-0 mt-0.5" />
    <div className="min-w-0 flex-1">
      <p className="text-[11.5px] font-medium text-ink">{t("safeMode.title")}</p>
      <p className="text-[10.5px] text-muted leading-relaxed mt-0.5">{t("safeMode.off")}</p>
      <p className="text-[10.5px] text-muted leading-relaxed">
        {safeMode.reason === "crashes"
          ? t("safeMode.crashes", { count: formatNumber(safeMode.crashes) })
          : t("safeMode.asked")}
      </p>
    </div>
    <button onClick={() => void window.electron?.restartNormally()} className="btn shrink-0">
      {t("safeMode.restart")}
    </button>
  </div>
);
