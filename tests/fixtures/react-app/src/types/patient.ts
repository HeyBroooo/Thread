export interface Patient {
  id: string;
  name: string;
  status: 'admitted' | 'discharged';
}

export type PatientId = string;
