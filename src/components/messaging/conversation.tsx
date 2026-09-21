import { ROLE } from '@/lib/labels';
import { fileStatusNote } from '@/lib/labels-documents';
import type { getThread } from '@/modules/messaging/service';

const dateTime = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

type Messages = Awaited<ReturnType<typeof getThread>>['messages'];

export function Conversation({ messages, viewerId }: { messages: Messages; viewerId: string }) {
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((message) => {
        const mine = message.authorId === viewerId;
        return (
          <li
            key={message.id}
            className={`max-w-[85%] rounded-lg border border-border p-3 text-sm ${mine ? 'self-end bg-primary/10' : 'self-start bg-surface-muted'}`}
          >
            <p className="mb-1 text-xs text-fg-muted">
              <span className="font-medium text-fg">
                {mine ? 'Tú' : (message.author?.name ?? message.senderEmail ?? 'Sistema')}
              </span>
              {message.author &&
                !mine &&
                message.author.role !== 'CLIENT_USER' &&
                ` · ${ROLE[message.author.role]}`}
              {' · '}
              <time dateTime={message.createdAt.toISOString()}>
                {dateTime.format(message.createdAt)}
              </time>
              {message.source === 'EMAIL' && ' · por correo'}
            </p>
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
            {message.attachments.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {message.attachments
                  .filter(({ file }) => !file.deletedAt)
                  .map(({ file }) => (
                    <li key={file.id}>
                      {file.status === 'CLEAN' ? (
                        <a
                          href={`/api/files/${file.id}?inline`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Adjunto: {file.originalName}
                        </a>
                      ) : (
                        <span className="text-fg-muted">
                          Adjunto: {file.originalName} ·{' '}
                          {fileStatusNote(file.status) ?? 'Subiendo…'}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
