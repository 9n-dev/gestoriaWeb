import type { DnsRecord } from '@/modules/branding/providers';

const STATUS: Record<string, string> = {
  verified: 'Correcto',
  pending: 'Pendiente',
  not_started: 'Pendiente',
  failed: 'Incorrecto',
};

export function RecordsTable({ records, caption }: { records: DnsRecord[]; caption: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="pb-2 text-left font-medium">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Tipo
            </th>
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Nombre
            </th>
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Valor
            </th>
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Para qué
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Estado
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={`${record.type}-${record.name}-${record.value}`}
              className="border-b border-border align-top"
            >
              <td className="py-1.5 pr-4">{record.type}</td>
              <td className="py-1.5 pr-4">
                <code className="break-all">{record.name}</code>
              </td>
              <td className="py-1.5 pr-4">
                <code className="break-all">{record.value}</code>
              </td>
              <td className="py-1.5 pr-4">{record.purpose}</td>
              <td className="py-1.5">
                {record.status ? (STATUS[record.status] ?? record.status) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
