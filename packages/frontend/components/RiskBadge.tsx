import type { RiskLevel } from "@/lib/api";
import { RISK_COLORS, RISK_LABELS } from "@/lib/statusMeta";

export function RiskBadge({ riskLevel }: { riskLevel: RiskLevel | null }) {
  if (!riskLevel) {
    return <span className="text-xs text-gray-400">Not yet assessed</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${RISK_COLORS[riskLevel]}`}
    >
      {RISK_LABELS[riskLevel]}
    </span>
  );
}
