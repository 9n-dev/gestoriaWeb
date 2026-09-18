export function ImportInstructions() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">
      <li>
        Descarga la{' '}
        <a href="/panel/clientes/importar/plantilla" download className="underline">
          plantilla CSV
        </a>{' '}
        y ábrela con Excel, Numbers o LibreOffice.
      </li>
      <li>
        Rellena una fila por cliente. Solo son obligatorios <strong>razon_social</strong> y{' '}
        <strong>nif</strong>; con <strong>email</strong> podrás invitarlos después con un clic.
      </li>
      <li>
        Guárdala como CSV y súbela aquí. Las filas con errores no se importan y te decimos por qué.
      </li>
    </ol>
  );
}
