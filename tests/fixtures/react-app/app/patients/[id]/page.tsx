import { PatientDetails } from '@/components/patient/PatientDetails';

export default function PatientPage({ params }: { params: { id: string } }) {
  return <PatientDetails patientId={params.id} />;
}
