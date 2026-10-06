import { useEffect, useState } from 'react';
import { getPatient, dischargePatient } from '@/services/patientService';
import type { Patient } from '@/types/patient';

export function usePatient(id: string) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getPatient(id)
      .then((result) => {
        if (active) setPatient(result);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function discharge(): Promise<void> {
    await dischargePatient(id);
    setPatient((current) => (current ? { ...current, status: 'discharged' } : current));
  }

  return { patient, loading, discharge };
}
