import { create } from 'zustand';
import type { Patient } from '@/types/patient';

interface PatientState {
  current: Patient | null;
  setCurrent: (patient: Patient | null) => void;
}

export const usePatientStore = create<PatientState>((set) => ({
  current: null,
  setCurrent: (patient) => set({ current: patient }),
}));
