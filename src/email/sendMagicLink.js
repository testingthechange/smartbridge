import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLinkEmail({
  to,
  projectId,
  token,
  producerName = "",
}) {
  const link = `${process.env.PUBLIC_SITE_BASE}/minisite/${projectId}?token=${token}`;

  return resend.emails.send({
    from: process.env.FROM_EMAIL,
    to,
    subject: "Your SmartBridge project link",
    html: `
      <p>${producerName ? `Hi ${producerName},` : "Hi,"}</p>
      <p>Your project is ready.</p>
      <p>
        <a href="${link}">Open your project</a>
      </p>
      <p>This link may expire.</p>
    `,
  });
}
