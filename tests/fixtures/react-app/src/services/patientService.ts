import { patientApi } from '@/api/patient';
import type { Patient } from '@/types/patient';

export async function getPatient(id: string): Promise<Patient> {
  const response = await patientApi.get(id);
  return response.data;
}

export async function dischargePatient(id: string): Promise<void> {
  await patientApi.discharge(id);
}
