import { dischargePatient } from '@/services/patientService';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  await dischargePatient(params.id);
  return Response.json({ ok: true });
}
