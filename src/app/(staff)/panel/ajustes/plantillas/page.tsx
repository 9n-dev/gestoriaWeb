import { requireArea } from '@/modules/auth/area';
import { listMessageTemplates } from '@/modules/messaging/templates';
import { DeleteTemplateButton, TemplateForm } from './template-forms';

export default async function MessageTemplatesPage() {
  const templates = await listMessageTemplates(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Plantillas de mensaje</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          Respuestas preparadas que tu equipo inserta en una conversación. Puedes usar{' '}
          <code>{'{{cliente}}'}</code>, <code>{'{{plazo}}'}</code> (próximo plazo del cliente) y{' '}
          <code>{'{{pendientes}}'}</code> (lo que le falta por entregar): se rellenan al insertar la
          plantilla.
        </p>
      </div>
      {templates.map((template) => (
        <details key={template.id} className="rounded-md border border-border p-4">
          <summary className="cursor-pointer font-medium">{template.name}</summary>
          <div className="mt-3 flex flex-col gap-2">
            <TemplateForm template={template} />
            <DeleteTemplateButton id={template.id} />
          </div>
        </details>
      ))}
      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-lg font-semibold">Nueva plantilla</h2>
        <TemplateForm />
      </section>
    </div>
  );
}
