"use client";

/** Keeps the reception portal's shell mounted when one screen fails. See ErrorRecovery. */

import { ErrorRecovery } from "@/components/portal/error-recovery";

export default function ReceptionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} where="reception" />;
}
