"use client";

/** Keeps the dev portal usable when the launcher itself fails. See ErrorRecovery. */

import { ErrorRecovery } from "@/components/portal/error-recovery";

export default function DevError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} where="dev" />;
}
