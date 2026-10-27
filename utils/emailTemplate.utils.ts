import { env } from "../Config/env";

export const escapeEmailHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

export const renderEmailHighlight = (label: string, value: string): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:24px 0;background:#f1f8f3;border:1px solid #dcebe0;border-radius:12px">
    <tr>
      <td style="padding:18px 20px">
        <p style="margin:0 0 5px;color:#587064;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">${escapeEmailHtml(label)}</p>
        <p style="margin:0;color:#123d2c;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;line-height:1.35;overflow-wrap:anywhere">${escapeEmailHtml(value)}</p>
      </td>
    </tr>
  </table>
`;

export const renderEmailCode = (code: string): string => `
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:24px 0;background:#f1f8f3;border:1px solid #dcebe0;border-radius:12px">
    <tr>
      <td align="center" style="padding:22px 16px">
        <p style="margin:0 0 8px;color:#587064;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Your one-time code</p>
        <p style="margin:0;color:#123d2c;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:700;letter-spacing:8px;line-height:1.4">${escapeEmailHtml(code)}</p>
      </td>
    </tr>
  </table>
`;

export const renderEmailDetails = (rows: Array<{ label: string; value: string }>): string => {
  if (rows.length === 0) return "";

  const rowMarkup = rows.map(({ label, value }, index) => `
    <tr>
      <td style="padding:12px 0;${index > 0 ? "border-top:1px solid #e7eee9;" : ""}color:#66786e;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;vertical-align:top">${escapeEmailHtml(label)}</td>
      <td align="right" style="padding:12px 0;${index > 0 ? "border-top:1px solid #e7eee9;" : ""}color:#182b21;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;line-height:1.5;vertical-align:top;overflow-wrap:anywhere">${escapeEmailHtml(value)}</td>
    </tr>
  `).join("");

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:20px 0">
      ${rowMarkup}
    </table>
  `;
};

export const renderEmailBulletList = (items: string[]): string => `
  <ul style="margin:16px 0;padding:0 0 0 22px;color:#35483d;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65">
    ${items.map((item) => `<li style="padding:0 0 8px 4px">${escapeEmailHtml(item)}</li>`).join("")}
  </ul>
`;

export const renderBrandedEmail = (input: {
  preheader: string;
  eyebrow?: string;
  heading: string;
  greetingName?: string;
  intro?: string;
  contentHtml?: string;
  closing?: string;
  footerNote?: string;
}): string => {
  const appName = escapeEmailHtml(env.APP_NAME);
  const preheader = escapeEmailHtml(input.preheader);
  const greeting = input.greetingName
    ? `<p style="margin:0 0 18px;color:#35483d;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65">Hello ${escapeEmailHtml(input.greetingName)},</p>`
    : "";
  const eyebrow = input.eyebrow
    ? `<p style="margin:0 0 10px;color:#16804f;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;line-height:1.4;text-transform:uppercase">${escapeEmailHtml(input.eyebrow)}</p>`
    : "";
  const intro = input.intro
    ? `<p style="margin:0 0 18px;color:#485a50;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7">${escapeEmailHtml(input.intro)}</p>`
    : "";
  const closing = input.closing
    ? `<p style="margin:20px 0 0;color:#485a50;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7">${escapeEmailHtml(input.closing)}</p>`
    : "";
  const footerNote = input.footerNote
    ? `<p style="margin:0 0 8px;color:#52665a;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6">${escapeEmailHtml(input.footerNote)}</p>`
    : "";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${escapeEmailHtml(input.heading)}</title>
        <style>
          @media only screen and (max-width:620px) {
            .cc-email-shell { padding:16px 10px !important; }
            .cc-email-card { border-radius:14px !important; }
            .cc-email-content { padding:28px 22px !important; }
            .cc-email-heading { font-size:25px !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#f2f6f3;color:#182b21">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#f2f6f3">
          <tr>
            <td align="center" class="cc-email-shell" style="padding:36px 16px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:separate">
                <tr>
                  <td style="padding:0 0 16px">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
                      <tr>
                        <td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border-radius:12px;background:#f4cf68;color:#103c2d;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;letter-spacing:-1px">CC</td>
                        <td style="padding:0 0 0 11px;color:#123d2c;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;letter-spacing:-.2px">${appName}<br><span style="color:#62756a;font-size:10px;font-weight:600;letter-spacing:1.4px">COMMUNITY, CONNECTED</span></td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="cc-email-card" style="overflow:hidden;border:1px solid #e1e9e3;border-radius:18px;background:#ffffff;box-shadow:0 8px 28px rgba(20,53,37,.06)">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse">
                      <tr><td height="5" style="height:5px;background:#087447;font-size:0;line-height:0">&nbsp;</td></tr>
                      <tr>
                        <td class="cc-email-content" style="padding:36px 40px 34px">
                          ${eyebrow}
                          <h1 class="cc-email-heading" style="margin:0 0 20px;color:#142b20;font-family:Arial,Helvetica,sans-serif;font-size:29px;font-weight:700;letter-spacing:-.7px;line-height:1.2">${escapeEmailHtml(input.heading)}</h1>
                          ${greeting}
                          ${intro}
                          ${input.contentHtml || ""}
                          ${closing}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:20px 14px 0">
                    ${footerNote}
                    <p style="margin:0;color:#62756a;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6">This service email was sent by ${appName}.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};
