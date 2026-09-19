import { requireArea } from '@/modules/auth/area';
import { listEmailTemplates } from '@/modules/branding/email-templates';
import { TemplateEditor } from './template-editor';

export default async function EmailTemplatesPage() {
  const templates = await listEmailTemplates(await requireArea('area.staff'));
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Textos de los emails</h1>
      <p className="max-w-2xl text-sm text-fg-muted">
        Todos los correos salen con tu logo, tu color y tu nombre de remitente. Aquí puedes cambiar
        lo que dicen. La vista previa usa datos de ejemplo.
      </p>
      {templates.map((template) => (
        <details key={template.key} className="rounded-md border border-border p-4">
          <summary className="cursor-pointer font-medium">
            {template.label}
            {template.customized && (
              <span className="ml-2 text-sm font-normal text-fg-muted">· personalizado</span>
            )}
          </summary>
          <div className="mt-4">
            <TemplateEditor template={template} />
          </div>
        </details>
      ))}
    </div>
  );
}
