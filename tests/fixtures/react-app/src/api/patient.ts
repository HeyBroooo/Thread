import { apiClient } from '@/lib/http';
import type { Patient } from '@/types/patient';

export const patientApi = {
  get: (id: string) => apiClient.get<Patient>(`/patient/${id}`),
  discharge: (id: string) => apiClient.post(`/patient/${id}/discharge`),
};
