import { usePatient } from '@/hooks/usePatient';
import { PatientActions } from './PatientActions';

export function PatientDetails({ patientId }: { patientId: string }) {
  const { patient, loading } = usePatient(patientId);

  if (loading || !patient) {
    return <div>Loading…</div>;
  }

  return (
    <section>
      <h1>{patient.name}</h1>
      <PatientActions patientId={patientId} />
    </section>
  );
}
