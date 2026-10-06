import { cn } from '@/lib/utils';
import { DischargeButton } from './DischargeButton';

export function PatientActions({ patientId }: { patientId: string }) {
  return (
    <div className={cn('flex', 'gap-2')}>
      <DischargeButton patientId={patientId} />
    </div>
  );
}
