'use client';

import { emailTemplateAction } from '@/app/actions/branding';
import { Field } from '@/components/ui/field';
import { ActionForm, TextareaField } from '@/components/ui/form';

type Preview = { subject: string; text: string; html: string };
const button =
  'inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-muted';

export function TemplateEditor({
  template,
}: {
  template: {
    key: string;
    subject: string;
    body: string;
    variables: string[];
    customized: boolean;
  };
}) {
  return (
    <ActionForm
      action={emailTemplateAction.bind(null, template.key)}
      className="flex flex-col gap-3"
      renderResult={(state) => {
        const preview = state.data as Preview | undefined;
        if (!preview) return null;
        return (
          <div className="mt-2 flex flex-col gap-2">
            <p>
              <strong>Asunto:</strong> {preview.subject}
            </p>
            {/* Sandboxed: the HTML is ours and escaped, but a preview never needs scripts. */}
            <iframe
              title="Vista previa del email"
              sandbox=""
              srcDoc={preview.html}
              className="h-96 w-full rounded-md border border-border bg-white"
            />
          </div>
        );
      }}
    >
      <Field
        label="Asunto"
        name="subject"
        id={`subject-${template.key}`}
        defaultValue={template.subject}
        required
      />
      <TextareaField
        label="Texto"
        name="body"
        id={`body-${template.key}`}
        defaultValue={template.body}
        rows={9}
        required
      />
      <p className="text-xs text-fg-muted">
        Variables disponibles: {template.variables.map((name) => `{{${name}}}`).join(' ')}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="preview" className={button}>
          Vista previa
        </button>
        <button
          type="submit"
          name="intent"
          value="save"
          className={`${button} border-0 bg-primary text-primary-fg`}
        >
          Guardar
        </button>
        {template.customized && (
          <button type="submit" name="intent" value="reset" className={button}>
            Restaurar el texto original
          </button>
        )}
      </div>
    </ActionForm>
  );
}
