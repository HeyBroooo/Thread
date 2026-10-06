import { cn } from '@/lib/utils';
import { dischargePatient } from '@/services/patientService';

export interface DischargeButtonProps {
  patientId: string;
  disabled?: boolean;
}

export function DischargeButton({ patientId, disabled }: DischargeButtonProps) {
  const handleDischarge = async () => {
    await dischargePatient(patientId);
  };

  return (
    <button
      type="button"
      className={cn('btn', 'btn-primary', disabled && 'btn-disabled')}
      disabled={disabled}
      onClick={handleDischarge}
    >
      Discharge patient
    </button>
  );
}
