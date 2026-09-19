const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → safe HTML: escaped, paragraphs, line breaks, clickable links, "- " lists kept readable. */
function textToHtml(text: string, linkColor: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => {
      const html = escape(paragraph)
        .replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${linkColor}">$1</a>`)
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px">${html}</p>`;
    })
    .join('');
}

export type EmailBrand = { tenantName: string; primaryColor: string; logoUrl?: string };

/** Branded wrapper for every email (§6.12). Table layout and inline styles: what mail clients render. */
export function renderEmailHtml(text: string, brand: EmailBrand): string {
  const header = brand.logoUrl
    ? `<img src="${escape(brand.logoUrl)}" alt="${escape(brand.tenantName)}" height="40" style="display:block;border:0;height:40px">`
    : `<span style="font-size:18px;font-weight:600;color:#18181b">${escape(brand.tenantName)}</span>`;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border-top:4px solid ${brand.primaryColor}">
<tr><td style="padding:24px 28px 8px">${header}</td></tr>
<tr><td style="padding:12px 28px 12px;font-size:15px;line-height:1.55">${textToHtml(text, brand.primaryColor)}</td></tr>
<tr><td style="padding:12px 28px 24px;font-size:12px;color:#52525b">Enviado por ${escape(brand.tenantName)} a través de su portal de clientes.</td></tr>
</table></td></tr></table></body></html>`;
}
