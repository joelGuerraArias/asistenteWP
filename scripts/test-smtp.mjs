import nodemailer from "nodemailer";
import { config } from "../src/config.mjs";

const [to, subject, text] = process.argv.slice(2);

const transport = nodemailer.createTransport({
  host: config.brevo.smtpServer,
  port: config.brevo.smtpPort,
  secure: false,
  auth: {
    user: config.brevo.smtpUser,
    pass: config.brevo.apiKey,
  },
});

const info = await transport.sendMail({
  from: `"${config.brevo.senderName}" <${config.brevo.senderEmail}>`,
  to: to || "belgicajr@gmail.com",
  subject: subject || "Prueba SMTP AsistenteWP",
  text: text || "Este es un correo de prueba enviado desde AsistenteWP.",
  html: `<p>${text || "Este es un correo de prueba enviado desde <strong>AsistenteWP</strong>."}</p>`,
});

console.log(JSON.stringify(
  {
    accepted: info.accepted,
    rejected: info.rejected,
    messageId: info.messageId,
    response: info.response,
  },
  null,
  2
));
