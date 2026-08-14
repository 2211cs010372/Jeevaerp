"use client";

/** Keeps the doctor portal's shell mounted when one screen fails. See ErrorRecovery. */

import { ErrorRecovery } from "@/components/portal/error-recovery";

export default function DoctorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorRecovery error={error} reset={reset} where="doctor" />;
}
