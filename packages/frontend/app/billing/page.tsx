import { Suspense } from "react";
import { BillingView } from "@/components/BillingView";

export default function BillingPage() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  );
}
